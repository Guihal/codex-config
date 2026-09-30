import { utf8Prefix } from './store.mjs';

// One assembler for every injection channel. Sizes include framing and footer.
export function buildInjection({ files, maxBytes, preamble = '' }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('invalid injection byte limit');
  const header = f => `\nFile ${f.id}: ${f.title}\n${f.path}\n`;
  const footer = cut => '\nINJECTION TRUNCATED. Read the full original files at:\n' + cut.map(f => f.path + '\n').join('');
  const total = Buffer.byteLength(preamble) + files.reduce((n, f) => n + Buffer.byteLength(header(f)) + f.bytes + 1, 0);
  const reserve = total > maxBytes ? Buffer.byteLength(footer(files)) : 0;
  if (Buffer.byteLength(preamble) + reserve > maxBytes) throw new Error('complete original file paths exceed injection budget');
  let output = preamble;
  const cut = [];
  for (const file of files) {
    const available = maxBytes - reserve - Buffer.byteLength(output);
    const framing = header(file);
    if (available < Buffer.byteLength(framing) + 1) { cut.push(file); continue; }
    const content = file.read();
    const room = available - Buffer.byteLength(framing) - 1;
    const part = utf8Prefix(content, room);
    output += framing + part + '\n';
    if (part !== content) cut.push(file);
  }
  if (cut.length) output += footer(cut);
  if (Buffer.byteLength(output) > maxBytes) throw new Error('injection byte limit exceeded');
  return { text: output, truncated: cut.length > 0, paths: cut.map(f => f.path) };
}
