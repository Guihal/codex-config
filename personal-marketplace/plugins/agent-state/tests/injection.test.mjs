import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection } from '../scripts/injection.mjs';

const file = (id, content) => ({ id, title: id, path: '/original/' + id + '.md', bytes: Buffer.byteLength(content), read: () => content });
test('all files that fit are injected in full, including a single near-budget file', () => {
  const files = [file('a', 'first'), file('b', 'second')];
  const result = buildInjection({ files, maxBytes: 80000 });
  assert.equal(result.truncated, false);
  for (const f of files) assert.ok(result.text.includes(f.read()));
  const near = file('near', 'x'.repeat(79900));
  assert.ok(buildInjection({ files: [near], maxBytes: 80000 }).text.includes(near.read()));
});
test('UTF-8 truncation is bounded and supplies every cut original path', () => {
  const files = [file('a', '😀'.repeat(25000)), file('b', 'remaining'), file('c', 'я'.repeat(50000))];
  const result = buildInjection({ files, maxBytes: 80000, preamble: 'Instructions\n' });
  assert.ok(Buffer.byteLength(result.text) <= 80000);
  assert.match(result.text, /INJECTION TRUNCATED/);
  assert.equal(result.text.includes('\uFFFD'), false);
  assert.deepEqual(result.paths, files.map(f => f.path));
  for (const f of files) assert.ok(result.text.includes(f.path));
});
test('impossible locator budget fails explicitly without dropping paths', () => {
  assert.throws(() => buildInjection({ files: [file('a', 'long body')], maxBytes: 10 }), /paths exceed/);
});
