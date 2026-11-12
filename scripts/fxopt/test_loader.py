"""Checks on fxopt_loader.py, the file that sits on Drive under the title fxopt.py. Standard library only, no
network. Run: python3 -I scripts/fxopt/test_loader.py

Why a loader: since 12 Nov 2026 a Drive text read returns a file with markdown characters escaped, indentation
flattened and two spaces after every line, which a long Python file does not survive. The loader is written to
survive that read, fetches fxopt.py from this repository at a pinned commit, checks its hash and runs it.
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LOADER = os.path.join(HERE, 'fxopt_loader.py')
PRICER = os.path.join(HERE, 'fxopt.py')
CACHE = '/tmp/claudemacrotrades-fxopt'
src = open(LOADER, encoding='utf-8').read()
fails = []


def check(name, ok, detail=''):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{' : ' + detail if detail and not ok else ''}")
    if not ok:
        fails.append(name)


# 1. the pinned hash is the pricer in this tree: a change to fxopt.py must come with a new loader on Drive
pinned = re.search(r'^h = "([0-9a-f]{64})"$', src, re.M)
actual = hashlib.sha256(open(PRICER, 'rb').read()).hexdigest()
check('pinned hash equals sha256 of fxopt.py', bool(pinned) and pinned.group(1) == actual,
      'fxopt.py changed: set c to a main commit that holds it, set h, upload the loader to Drive as fxopt.py')
check('pinned commit is a full id', bool(re.search(r'^c = "[0-9a-f]{40}"$', src, re.M)))

# 2. nothing in the loader that the Drive read escapes or flattens
risky = sorted(set(re.findall(r'[_*\[\]<>#!\\`~|&$^{}%@]', src)))
check('no character that the Drive read escapes', not risky, ' '.join(risky))
lines = src.split('\n')
check('no indented line', not [l for l in lines if l[:1] in (' ', '\t')])
check('no line that starts like a list, a quote or a heading rule', not [l for l in lines if re.match(r'^(\d+[.)]|[-+>=])', l)])
check('ends with one newline, no blank line inside', src.endswith('\n') and '' not in lines[:-1])

# 3. as Drive returns it (two spaces after each line, last newline dropped) it gives the pricer's own output
legs = json.dumps([
    dict(pair='USDJPY', type='call', spot=159.7, days=30, rd=4.5, rf=0.75, strike=161, vol=9.5),
    dict(pair='USDJPY', type='one_touch', spot=159.7, days=30, rd=4.5, rf=0.75, barrier=162, vol=9.5),
    dict(pair='EURUSD', type='put', spot=1.1, days=60, rd=4.5, rf=2.0, strike=1.08, atm=7.5, rr25=-0.6, bf25=0.2),
])
run = lambda *a, **k: subprocess.run([sys.executable, '-I', *a], capture_output=True, text=True, **k)
direct = run(PRICER, legs)
had_cache = os.path.isdir(CACHE)
tmp = tempfile.mkdtemp()
try:
    if not had_cache:  # seed the loader's cache so the test needs no network
        os.makedirs(CACHE + '/scripts/fxopt')
        shutil.copy(PRICER, CACHE + '/scripts/fxopt/fxopt.py')
    as_read = os.path.join(tmp, 'fxopt.py')
    open(as_read, 'w', encoding='utf-8').write('  \n'.join(lines[:-1]) + '  ')
    by_arg = run(as_read, legs)
    by_stdin = run(as_read, input=legs)
    usage = run(as_read, 'usage')
    bad = run(as_read, '{"type": "nope"}')
    check('pricer itself runs', direct.returncode == 0 and direct.stdout.startswith('['), direct.stderr[-200:])
    check('loader, JSON as the argument: same output', by_arg.returncode == 0 and by_arg.stdout == direct.stdout, by_arg.stderr[-200:])
    check('loader, JSON on stdin: same output', by_stdin.returncode == 0 and by_stdin.stdout == direct.stdout, by_stdin.stderr[-200:])
    check('loader usage prints the pricer usage text', usage.returncode == 0 and 'Usage: python3 fxopt.py' in usage.stdout)
    check('a bad leg fails loudly, nothing on stdout', bad.returncode != 0 and bad.stdout == '')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    if not had_cache:
        shutil.rmtree(CACHE, ignore_errors=True)

print('fxopt loader:', 'FAIL ' + '; '.join(fails) if fails else 'all checks pass')
sys.exit(1 if fails else 0)
