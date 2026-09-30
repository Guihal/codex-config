"""Bounded read-only candidates, not a claim of effective per-thread config."""
import json, os, pathlib, re, stat, sys, tomllib

KEYS = {'model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope',
        'model_context_window', 'model_post_turn_compact_threshold_percent',
        'profile', 'model_catalog_json', 'model'}

def resolve(data):
    home = pathlib.Path(data['home'])
    cwd = pathlib.Path(data.get('cwd') or data['home'])
    sources, limits, windows, percents, scopes = [], [], [], [], []
    read_total = 0

    def load(file, decoder=tomllib.loads, bound=1048576):
        nonlocal read_total
        file = pathlib.Path(file)
        if not file.exists():
            return {}
        for part in [file, *file.parents]:
            if part.is_symlink():
                raise ValueError('symlink config path')
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > bound:
                raise ValueError('config file size bound')
            chunks, size = [], 0
            while size <= bound:
                chunk = os.read(fd, min(65536, bound + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk); size += len(chunk)
            raw = b''.join(chunks)
        finally:
            os.close(fd)
        read_total += len(raw)
        if len(raw) > bound or read_total > 8 * 1048576:
            raise ValueError('config read budget')
        return decoder(raw.decode('utf8'))

    def candidate(config, source):
        if not isinstance(config, dict):
            raise ValueError('invalid config object')
        v = config.get('model_auto_compact_token_limit')
        if type(v) is int and v >= 0:
            limits.append(v); sources.append(source)
        w = config.get('model_context_window')
        if type(w) is int and w > 0:
            windows.append(w)
        p = config.get('model_post_turn_compact_threshold_percent')
        if type(p) is int and 0 < p <= 100:
            percents.append(p)
        if 'model_auto_compact_token_limit_scope' in config:
            scopes.append(config['model_auto_compact_token_limit_scope'])

    base = load(home / 'config.toml')
    candidate(load('/etc/codex/config.toml'), '/etc/codex/config.toml')
    candidate(base, str(home / 'config.toml'))
    cli, selected = {}, None
    pid = os.getppid()
    for _ in range(16):
        try:
            proc = pathlib.Path('/proc') / str(pid)
            with (proc / 'cmdline').open('rb') as stream:
                args = stream.read(65536).split(b'\0')
            args = [a.decode('utf8', errors='replace') for a in args if a]
            with (proc / 'stat').open() as stream:
                proc_stat = stream.read(4096)
            parent = int(proc_stat[proc_stat.rfind(')') + 2:].split()[1])
        except (OSError, ValueError):
            break
        if args and pathlib.Path(args[0]).name == 'codex':
            for i, arg in enumerate(args):
                if arg in ('--profile', '-p') and i + 1 < len(args):
                    selected = args[i + 1]
                elif arg.startswith('--profile='):
                    selected = arg.split('=', 1)[1]
                elif arg.startswith('-p') and len(arg) > 2:
                    selected = arg[2:]
                value = None
                if arg in ('--config', '-c') and i + 1 < len(args):
                    value = args[i + 1]
                elif arg.startswith('--config='):
                    value = arg.split('=', 1)[1]
                elif arg.startswith('-c') and len(arg) > 2:
                    value = arg[2:]
                if value is not None:
                    key = value.split('=', 1)[0].strip()
                    if key in KEYS:
                        cli.update(tomllib.loads(value))
            break
        if parent <= 1:
            break
        pid = parent
    if selected:
        if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,64}', selected) or selected in ('.', '..'):
            raise ValueError('invalid profile locator')
        profile = load(home / (selected + '.config.toml'))
        candidate(profile, str(home / (selected + '.config.toml')))
    else:
        # Legacy named profiles cannot set compact/window keys in0.159.1.
        profile = base.get('profiles', {}).get(cli.get('profile', base.get('profile')), {})
    projects = base.get('projects', {})
    keys = [str(cwd), *map(str, cwd.parents)]
    trust = next((projects[k].get('trust_level') for k in keys if k in projects), None)
    if trust == 'trusted':
        paths = [cwd / 'config.toml'] + [d / '.codex/config.toml' for d in [*reversed(cwd.parents), cwd]]
        if len(paths) > 34:
            raise ValueError('config ancestor bound')
        for file in dict.fromkeys(paths):
            if file != home / 'config.toml':
                candidate(load(file), str(file))
    candidate(cli, 'Codex ancestor CLI flags')
    candidate(load('/etc/codex/managed_config.toml'), '/etc/codex/managed_config.toml')
    catalog = cli.get('model_catalog_json') or profile.get('model_catalog_json') or base.get('model_catalog_json')
    catalog_path = pathlib.Path(catalog) if catalog else home / 'models_cache.json'
    if not catalog_path.is_absolute():
        catalog_path = home / catalog_path
    models = load(catalog_path, json.loads, 4 * 1048576).get('models', [])
    model = next((m for m in models if m.get('slug') == data.get('model')), None)
    if model:
        raw = model.get('context_window') or model.get('max_context_window')
        if type(raw) is int and raw > 0:
            windows.append(raw)
        configured = model.get('auto_compact_token_limit')
        if type(configured) is int and configured >= 0:
            limits.append(configured)
    if windows:
        limits.append(min(windows) * 9 // 10); sources.append('native model cap:90% raw window')
    window = data.get('window')
    if percents and type(window) is int and window > 0:
        limits.append(window * min(percents) // 100); sources.append('configured post-turn full-window percentage')
    limit = min(limits) if limits else None
    save_at = limit * 80 // 100 if limit is not None else (window * 80 // 100 if type(window) is int and window > 0 else None)
    return {'candidate_limit': limit, 'save_at': save_at,
            'basis': 'conservative config/model candidates' if limit is not None else 'declared-window proxy; config cutoff unresolved',
            'sources': sources, 'scopes': scopes, 'profile': selected or base.get('profile'),
            'calibration': 'UNCALIBRATED: UI/thread/cloud overrides and carried-prefix baseline are not exposed'}

if __name__ == '__main__':
    try:
        print(json.dumps(resolve(json.loads(sys.stdin.read(16384)))))
    except Exception as error:
        # Parser details may quote credentials. Return only the error class.
        print(json.dumps({'error': 'UNCALIBRATED config lookup failed: ' + type(error).__name__}))
