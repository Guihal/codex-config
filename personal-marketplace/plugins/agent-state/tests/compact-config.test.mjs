import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../scripts/compact-config.py', import.meta.url).pathname;
function setup() {
  const root = fs.mkdtempSync('/home/penis/tmp/compact-config-tests-');
  const home = path.join(root, 'codex'), cwd = path.join(root, 'project');
  fs.mkdirSync(home); fs.mkdirSync(cwd);
  return { home, cwd, model: 'fixture', window: 10000 };
}
function policy(data) {
  const child = spawnSync('python3', [script], { input: JSON.stringify(data), encoding: 'utf8', timeout: 1500 });
  assert.equal(child.status, 0); return JSON.parse(child.stdout);
}
test('explicit root compact limit and scope are read, malformed config remains explicit', () => {
  const data = setup();
  fs.writeFileSync(path.join(data.home, 'config.toml'), 'model_auto_compact_token_limit=5000\nmodel_auto_compact_token_limit_scope="body_after_prefix"\n');
  const p = policy(data); assert.equal(p.save_at, 4000); assert.equal(p.candidate_limit, 5000);
  assert.ok(p.scopes.includes('body_after_prefix')); assert.match(p.calibration, /UNCALIBRATED/);
  fs.writeFileSync(path.join(data.home, 'config.toml'), 'invalid=[');
  assert.match(policy(data).error, /UNCALIBRATED.*TOMLDecodeError/);
});
test('trusted project config lowers candidate; untrusted project keys do not affect it', () => {
  const data = setup(); fs.mkdirSync(path.join(data.cwd, '.codex'));
  fs.writeFileSync(path.join(data.cwd, '.codex/config.toml'), 'model_auto_compact_token_limit=1000\n');
  fs.writeFileSync(path.join(data.home, 'config.toml'), 'model_auto_compact_token_limit=5000\n');
  assert.equal(policy(data).save_at, 4000);
  fs.appendFileSync(path.join(data.home, 'config.toml'), '\n[projects.' + JSON.stringify(data.cwd) + ']\ntrust_level="trusted"\n');
  assert.equal(policy(data).save_at, 800);
});
test('catalog cap, configured post-turn threshold and unresolved-window fallback', () => {
  const data = setup(); assert.equal(policy(data).save_at, 8000);
  fs.writeFileSync(path.join(data.home, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'fixture', context_window: 20000, auto_compact_token_limit: 6000 }] }));
  assert.equal(policy(data).save_at, 4800);
  fs.writeFileSync(path.join(data.home, 'config.toml'), 'model_post_turn_compact_threshold_percent=40\n');
  assert.equal(policy(data).save_at, 3200);
});
test('unsupported legacy-profile cutoff is ignored and nonregular/symlink configs fail promptly', () => {
  const data = setup();
  fs.writeFileSync(path.join(data.home, 'config.toml'), 'profile="legacy"\n[profiles.legacy]\nmodel_auto_compact_token_limit=1\n');
  assert.equal(policy(data).save_at, 8000);
  fs.unlinkSync(path.join(data.home, 'config.toml'));
  fs.symlinkSync(path.join(data.cwd, 'secret'), path.join(data.home, 'config.toml'));
  fs.writeFileSync(path.join(data.cwd, 'secret'), 'model_auto_compact_token_limit=1\n');
  assert.match(policy(data).error, /ValueError/);
  fs.unlinkSync(path.join(data.home, 'config.toml')); fs.mkdirSync(path.join(data.home, 'config.toml'));
  assert.match(policy(data).error, /ValueError/);
});
test('selected profile-v2 and CLI compact override candidates support separate and joined flags', () => {
  const data = setup();
  fs.writeFileSync(path.join(data.home, 'config.toml'), 'model_auto_compact_token_limit=5000\n');
  fs.writeFileSync(path.join(data.home, 'strict.config.toml'), 'model_auto_compact_token_limit=2000\n');
  for (const args of [['codex', '-p', 'strict', '-c', 'model_auto_compact_token_limit=1000'], ['codex', '--profile=strict', '--config=model_auto_compact_token_limit=1000'], ['codex', '-pstrict', '-cmodel_auto_compact_token_limit=1000']]) {
    const probe = `import importlib.util,io,json,pathlib,unittest.mock as mock
spec=importlib.util.spec_from_file_location('policy',${JSON.stringify(script)})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
original=pathlib.Path.open
def fake_open(file,*args,**kwargs):
 if str(file)=='/proc/123/cmdline': return io.BytesIO(('\\0'.join(json.loads(${JSON.stringify(JSON.stringify(args))}))+'\\0').encode())
 if str(file)=='/proc/123/stat': return io.StringIO('123 (codex) S 1 ')
 return original(file,*args,**kwargs)
with mock.patch.object(module.os,'getppid',return_value=123), mock.patch.object(pathlib.Path,'open',fake_open):
 print(json.dumps(module.resolve(json.loads(${JSON.stringify(JSON.stringify(data))}))))
`;
    const child = spawnSync('python3', ['-c', probe], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const p = JSON.parse(child.stdout); assert.equal(p.save_at, 800); assert.equal(p.profile, 'strict');
    assert.ok(p.sources.includes(path.join(data.home, 'strict.config.toml')));
  }
});
