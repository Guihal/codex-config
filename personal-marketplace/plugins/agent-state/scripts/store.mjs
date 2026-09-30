import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const CAPS = { note: 131072, checkpoint: 8192, context: 80000, reason: 9216, page: 8192, entries: 4096 };
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const home = () => path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
export const root = () => path.resolve(process.env.CODEX_AGENT_STATE_STATE_DIR || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'codex-agent-state'));
export function actor(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error('trusted Codex thread metadata missing or invalid');
  return value;
}
export const directory = id => path.join(root(), 'sessions', hash(actor(id)));
export function checkPath(file) {
  let current = path.parse(path.resolve(file)).root;
  for (const part of path.resolve(file).slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symlink rejected'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
export function makeDirectory(dir) { checkPath(dir); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
export function readBytes(file, max = 4 * 1024 * 1024) {
  checkPath(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) throw new Error('file type/size outside supported bounds');
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const n = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!n) throw new Error('file changed while reading');
      offset += n;
    }
    return buffer;
  } finally { fs.closeSync(fd); }
}
export function readJson(file) {
  try { return JSON.parse(readBytes(file).toString('utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export function atomic(file, bytes) {
  checkPath(file); makeDirectory(path.dirname(file));
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
    const parent = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    const actual = readBytes(file, Math.max(4 * 1024 * 1024, Buffer.byteLength(bytes)));
    if (!actual.equals(Buffer.from(bytes))) throw new Error('durable read-back mismatch');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
export const writeJson = (file, data) => atomic(file, JSON.stringify(data) + '\n');
function processIdentity(pid) {
  try {
    const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return { boot, start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] };
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function transaction(id, action) {
  const dir = directory(id); makeDirectory(dir);
  const lock = path.join(dir, 'lock'); const token = crypto.randomUUID();
  // Never unlink this inode. The inherited open file description retains flock
  // after the helper exits; close/process death releases it in the kernel.
  const mutex = path.join(dir, 'mutex'); checkPath(mutex);
  const mutexFd = fs.openSync(mutex, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  const prepared = path.join(dir, `lock.${token}.tmp`);
  let owned = false;
  try {
    const identity = processIdentity(process.pid);
    if (!fs.fstatSync(mutexFd).isFile()) throw new Error('invalid session mutex file');
    await new Promise((resolve, reject) => {
      const helper = spawn('/usr/bin/flock', ['-x', '-w', '1.2', '-E', '75', '3'], { stdio: ['ignore', 'ignore', 'pipe', mutexFd], env: { ...process.env, LC_ALL: 'C' }, timeout: 2500, killSignal: 'SIGKILL' });
      let diagnostic = '';
      helper.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(0, 512); });
      helper.on('error', error => reject(new Error(`session kernel lock unavailable: ${error.message}`)));
      helper.on('close', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(code === 75 ? 'session lock busy; retry' : `session kernel lock failed (${code ?? signal}): ${diagnostic.trim()}`));
      });
    });
    if (!identity?.boot || !identity.start) throw new Error('session lock process identity unavailable');
    // Publish complete owner bytes atomically, avoiding empty/partial crash locks.
    const fd = fs.openSync(prepared, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ...identity, token })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    const deadline = Date.now() + 1200;
    while (!owned) {
      try {
        checkPath(lock); fs.linkSync(prepared, lock); owned = true;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        // Retain the legacy gate: older workers do not participate in flock.
        // Only proven dead owners may be reclaimed, serialized by the mutex.
        const owner = readJson(lock);
        if (owner === null && !fs.existsSync(lock)) {
          if (Date.now() >= deadline) throw new Error('session lock busy; retry');
          continue; // A legacy owner released the gate meanwhile.
        }
        if (owner && Number.isInteger(owner.pid) && owner.pid > 0 && typeof owner.boot === 'string' && owner.boot && typeof owner.start === 'string' && owner.start && typeof owner.token === 'string' && owner.token) {
          const live = processIdentity(owner.pid);
          if (!live || live.boot !== owner.boot || live.start !== owner.start) {
            fs.unlinkSync(lock); continue;
          }
        }
        if (Date.now() >= deadline) throw new Error('session lock busy/unknown owner; retry or inspect the lock');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    fs.unlinkSync(prepared);
    const file = path.join(dir, 'state.json');
    const state = readJson(file) ?? { version: 1, actor: id, tools: 0, cursorKey: crypto.randomBytes(32).toString('hex') };
    if (state.version !== 1 || state.actor !== id || !/^[0-9a-f]{64}$/.test(state.cursorKey ?? '') || !Number.isSafeInteger(state.tools) || state.tools < 0 || (state.epoch && (!Number.isSafeInteger(state.epoch.cut) || state.epoch.cut < 0 || !(state.epoch.deliveryFloor === null || (Number.isSafeInteger(state.epoch.deliveryFloor) && state.epoch.deliveryFloor >= 0))))) throw new Error('corrupt/incompatible session state; original retained');
    const result = await action(state, dir);
    writeJson(file, state);
    return result;
  } finally {
    try {
      if (owned && readJson(lock)?.token === token) fs.unlinkSync(lock);
    } finally {
      try { fs.unlinkSync(prepared); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      finally { fs.closeSync(mutexFd); }
    }
  }
}
export function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text`);
  if (Buffer.from(value).toString('utf8') !== value || Buffer.byteLength(value) > max) throw new Error(`${label} exceeds UTF-8 byte bound or contains invalid Unicode`);
  return value;
}
export function checkpoint(id) {
  const record = readJson(path.join(directory(id), 'checkpoint.json'));
  if (!record) return null;
  text(record.content, CAPS.checkpoint, 'checkpoint');
  if (record.actor !== id || record.version !== 1 || record.hash !== hash(record.content) || !Number.isSafeInteger(record.revision)) throw new Error('corrupt instructional checkpoint; original retained');
  return record;
}
export function saveCheckpoint(id, content, sample) {
  text(content, CAPS.checkpoint, 'content');
  const previous = checkpoint(id);
  const record = { version: 1, actor: id, content, hash: hash(content), revision: (previous?.revision ?? 0) + 1, savedAt: new Date().toISOString(), observedResponse: sample?.response_id ?? null };
  writeJson(path.join(directory(id), 'checkpoint.json'), record);
  return record;
}
export function saveNote(id, title, body, shared = false, existingId) {
  text(title, 256, 'title'); text(body, CAPS.note, 'body');
  if (/[\x00-\x1f\x7f]/.test(title) || typeof shared !== 'boolean') throw new Error('invalid title/shared');
  const content = `shared:${shared}\n# ${title}\n\n${body}`;
  text(content, CAPS.note, 'note file');
  if (existingId !== undefined && !/^[0-9a-f]{64}$/.test(existingId)) throw new Error('invalid file index');
  let noteId = existingId ?? hash(content);
  const dir = path.join(directory(id), 'notes'); makeDirectory(dir);
  let file = path.join(dir, `${noteId}.md`);
  if (existingId !== undefined) {
    readNote(id, existingId); // Only an existing own file may be edited.
    atomic(file, content);
    return { note_id: noteId, hash: hash(content), path: file, shared };
  }
  try {
    const existing = readBytes(file, CAPS.note);
    if (!existing.equals(Buffer.from(content))) {
      // The historical content-derived index may now refer to an edited file.
      noteId = hash(crypto.randomUUID()); file = path.join(dir, `${noteId}.md`);
      if (noteIndex(id).length >= CAPS.entries) throw new Error('guide file capacity reached');
      atomic(file, content);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (noteIndex(id).length >= CAPS.entries) throw new Error('ledger index capacity reached; original notes retained');
    atomic(file, content);
  }
  return { note_id: noteId, hash: hash(content), path: file, shared };
}
export function noteIndex(id) {
  const dir = path.join(directory(id), 'notes'); checkPath(dir);
  let handle;
  try { handle = fs.opendirSync(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const result = [];
  try {
    for (let entry; (entry = handle.readSync());) {
      if (!/^[0-9a-f]{64}\.md$/.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('invalid ledger entry');
      if (result.length >= CAPS.entries) throw new Error('ledger index outside supported bounds; use known note ids');
      const file = path.join(dir, entry.name); checkPath(file);
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const head = Buffer.alloc(512); const n = fs.readSync(fd, head, 0, head.length, 0);
        const prefix = head.subarray(0, n).toString('utf8');
        result.push({ id: entry.name.slice(0, -3), actor: id, path: file, shared: prefix.startsWith('shared:true\n'), title: prefix.split('\n')[1]?.slice(2) || '(invalid header)', bytes: fs.fstatSync(fd).size });
      } finally { fs.closeSync(fd); }
    }
  } finally { handle.closeSync(); }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
export function readNote(id, noteId, sharedOnly = false) {
  if (!/^[0-9a-f]{64}$/.test(noteId ?? '')) throw new Error('invalid note id');
  const file = path.join(directory(id), 'notes', `${noteId}.md`);
  const bytes = readBytes(file, CAPS.note), content = bytes.toString('utf8');
  if (sharedOnly && !content.startsWith('shared:true\n')) throw new Error('note unavailable in this scope');
  if (Buffer.from(content).compare(bytes)) throw new Error('invalid UTF-8 guide file');
  return content;
}
export function visibleNotes(id, parent) {
  return [...noteIndex(id), ...(parent ? noteIndex(actor(parent)).filter(n => n.shared) : [])];
}
export function cursor(state, data) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', state.cursorKey).update(body).digest('hex')}`;
}
export function decodeCursor(state, value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('invalid cursor');
  const [body, mac, extra] = value.split('.');
  const expected = crypto.createHmac('sha256', state.cursorKey).update(body || '').digest('hex');
  if (extra || typeof mac !== 'string' || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new Error('cursor outside actor/query scope');
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}
export function utf8Prefix(value, bytes) {
  let result = '', size = 0;
  for (const point of value) { const n = Buffer.byteLength(point); if (size + n > bytes) break; result += point; size += n; }
  return result;
}
