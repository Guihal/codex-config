#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import fs from 'node:fs';
import { CAPS, actor, transaction, checkpoint, saveCheckpoint, saveNote, visibleNotes, readNote, cursor, decodeCursor, utf8Prefix, hash } from './store.mjs';
import { bind, scan, usage, history } from './rollout.mjs';
import { POLICY } from './agent-state-hook.mjs';

const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string', minLength: 1 };
const VERSION = JSON.parse(fs.readFileSync(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8')).version;
export const TOOLS = [
  { name: 'agent_state_note', title: 'Save or Edit Reusable Guide', description: 'Save a reusable micro-skill or guide for future actions: applicability, procedure, pitfalls, verification. Pass an existing note_id (file index) to edit that own file; omit it to create a file. Do not store current task state, goals, progress or status; those stay in conversation/control state. Call this tool and continue the task; no separate confirmation or read-back call is required. The tool owns saving and returns an error if it fails. Runtime code binds session and paths. Do not recursively summarize the folder. Max128KiB UTF-8; shared defaults false and permits immediate children to read this file.', inputSchema: schema({ title: { ...string, maxLength: 256 }, body: string, note_id: { type: 'string', pattern: '^[0-9a-f]{64}$' }, shared: { type: 'boolean', default: false } }, ['title', 'body']) },
  { name: 'agent_state_checkpoint', title: 'Save Compatibility Guide', description: 'Replace the optional concise future-action guide. This is not a session-summary or task-state checkpoint; goals/progress/status stay in conversation/control state. Call this tool and continue the task. No separate confirmation or read-back call is required; the tool owns the write and returns an error if it fails. Max8KiB UTF-8. Do not recursively summarize the original files.', inputSchema: schema({ content: string }, ['content']) },
  { name: 'agent_state_history', title: 'Search Own Original History', description: 'Search original model-visible user/assistant/tool history of this Codex thread, including before compaction. Literal text only; bounded pages and opaque cursors. Child inherited parent history and contextual instructions are excluded. Runtime code binds actor and original rollout locators; never construct session ids or paths.', inputSchema: schema({ query: { ...string, maxLength: 256 }, cursor: string, limit: { type: 'integer', minimum: 1, maximum: 20 } }, ['query']) },
  { name: 'agent_state_read', title: 'Read Original Guides and Usage', description: 'Read original reusable guides, never re-compressed. Without note_id, list own anchor and permitted own/immediate-parent shared notes plus exact last-response token usage, declared window and freshness. With note_id, paginate its full original text. Current task state belongs to conversation/task context. No sid/path arguments; runtime code enforces scope.', inputSchema: schema({ note_id: { type: 'string', pattern: '^[0-9a-f]{64}$' }, cursor: string }) },
].map(tool => ({ ...tool, annotations: { readOnlyHint: !['agent_state_note', 'agent_state_checkpoint'].includes(tool.name), destructiveHint: false, openWorldHint: false } }));
function validate(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
  if (Object.keys(args).some(k => !Object.hasOwn(tool.inputSchema.properties, k))) throw new Error('unknown argument (session/path inputs are forbidden)');
  for (const key of tool.inputSchema.required) if (!Object.hasOwn(args, key)) throw new Error(`missing ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const type = tool.inputSchema.properties[key].type;
    if (type === 'integer' ? !Number.isInteger(value) : typeof value !== type) throw new Error(`invalid ${key}`);
  }
}
export async function callTool(params) {
  try {
    const tool = TOOLS.find(t => t.name === params?.name);
    if (!tool) throw new Error('unknown tool');
    validate(tool, params.arguments);
    const id = actor(params._meta?.threadId);
    const value = await transaction(id, state => {
      bind(state); scan(state);
      const a = params.arguments;
      if (tool.name === 'agent_state_note') return { status: 'committed', ...saveNote(id, a.title, a.body, a.shared ?? false, a.note_id), verified_read_back: true };
      if (tool.name === 'agent_state_checkpoint') {
        const record = saveCheckpoint(id, a.content, state.reader?.sample);
        return { status: 'committed', hash: record.hash, revision: record.revision, verified_read_back: true, meaning: 'instructional guides, not task state' };
      }
      if (tool.name === 'agent_state_history') return history(state, a.query, a.cursor, a.limit);
      const notes = visibleNotes(id, state.binding.parent);
      if (!a.note_id) {
        const offset = a.cursor ? decodeCursor(state, a.cursor) : { kind: 'index', offset: 0, signature: hash(JSON.stringify(notes.map(n => [n.id, n.actor]))) };
        if (offset.kind !== 'index' || offset.signature !== hash(JSON.stringify(notes.map(n => [n.id, n.actor]))) || !Number.isSafeInteger(offset.offset) || offset.offset < 0) throw new Error('stale/invalid index cursor');
        const page = notes.slice(offset.offset, offset.offset + 20);
        return { anchor: checkpoint(id), notes: page.map(n => ({ note_id: n.id, title: n.title, shared: n.shared, scope: n.actor === id ? 'own' : 'parent-shared', path: n.path, bytes: n.bytes })), total_notes: notes.length, next_cursor: offset.offset + 20 < notes.length ? cursor(state, { ...offset, offset: offset.offset + 20 }) : null, usage: usage(state) };
      }
      const note = notes.find(n => n.id === a.note_id);
      if (!note) throw new Error('note unavailable in this scope');
      const content = readNote(note.actor, note.id, note.actor !== id);
      const digest = hash(content);
      const page = a.cursor ? decodeCursor(state, a.cursor) : { kind: 'note', note: note.id, owner: note.actor, digest, offset: 0 };
      if (page.digest !== digest) throw new Error('stale guide cursor: file edited; restart reading');
      if (page.kind !== 'note' || page.note !== note.id || page.owner !== note.actor || !Number.isInteger(page.offset) || page.offset < 0 || page.offset > content.length || (page.offset && /[\uDC00-\uDFFF]/.test(content[page.offset]))) throw new Error('invalid note cursor');
      const part = utf8Prefix(content.slice(page.offset), CAPS.page);
      const end = page.offset + part.length;
      return { note_id: note.id, content: part, hash: digest, next_cursor: end < content.length ? cursor(state, { ...page, offset: end }) : null };
    });
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: '[agent-state] DEGRADED: ' + utf8Prefix(error?.message || String(error), 1000) }] };
  }
}
export async function serve() {
  let pending = 0, queue = Promise.resolve(), buffer = ''; const decoder = new StringDecoder('utf8');
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  async function dispatch(message) {
    const { id, method, params } = message;
    let result;
    if (method === 'initialize') result = { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent-state', title: 'Agent Guides', version: VERSION }, instructions: POLICY + ' Use agent_state_read without note_id for exact token usage. Never supply/guess a session id or path.' };
    else if (method === 'ping') result = {};
    else if (method === 'tools/list') result = { tools: TOOLS };
    else if (method === 'tools/call') result = await callTool(params);
    else if (!Object.hasOwn(message, 'id')) return;
    else { send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown method' } }); return; }
    send({ jsonrpc: '2.0', id, result });
  }
  for await (const data of process.stdin) {
    buffer += decoder.write(data);
    if (Buffer.byteLength(buffer) > 256 * 1024) { send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request size bound exceeded' } }); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); if (message.jsonrpc !== '2.0') throw new Error('invalid RPC'); }
      catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'invalid RPC JSON' } }); continue; }
      if (pending >= 32) { send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32600, message: 'bounded request queue busy' } }); continue; }
      pending++;
      queue = queue.then(() => dispatch(message)).catch(() => send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: 'internal dispatch failure' } })).finally(() => pending--);
    }
  }
  await queue;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await serve();
