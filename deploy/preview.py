"""Phone-test preview of the mobile (toy) build: https://smash-toy-preview.botc-lite.workers.dev

    python deploy/preview.py            # build deploy/preview/dist only
    python deploy/preview.py --deploy   # build, `wrangler deploy`, then check the live site

Only the whitelisted game files go out. Never .env, and nothing else from the repo root:
ads.txt, sitemap.xml, privacy.html and robots.txt there belong to the real web site. The preview
has its own _headers (noindex, no-cache) and robots.txt in deploy/preview/static/.
"""
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / 'deploy' / 'preview'
DIST = HERE / 'dist'
URL = 'https://smash-toy-preview.botc-lite.workers.dev'
FILES = ['index.html', 'favicon.ico', 'og.jpg']
DIRS = ['src', 'data']
SKIP = shutil.ignore_patterns('.*', '__pycache__', '*.py')


def build():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    for f in FILES:
        shutil.copy2(ROOT / f, DIST / f)
    for d in DIRS:
        shutil.copytree(ROOT / d, DIST / d, ignore=SKIP)
    for f in (HERE / 'static').iterdir():
        shutil.copy2(f, DIST / f.name)
    files = [p for p in DIST.rglob('*') if p.is_file()]
    secret = [p for p in files if p.name.startswith('.env') or p.suffix in ('.pem', '.key')]
    if secret:
        sys.exit(f'refusing: secret-looking files in dist: {secret}')
    print(f'built {DIST} ({len(files)} files)')


def status(path):
    req = urllib.request.Request(URL + path, headers={'User-Agent': 'preview-check'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b''


def deploy():
    subprocess.run('npx wrangler deploy', cwd=HERE, shell=True, check=True)
    root, _ = status('/')
    env, _ = status('/.env')
    _, names = status('/src/names.js')
    same = names == (ROOT / 'src' / 'names.js').read_bytes()
    print(f'live check: / -> {root}, /.env -> {env} (must be 404), src matches local: {same}')
    if root != 200 or env != 404 or not same:
        sys.exit('live check failed')


if __name__ == '__main__':
    build()
    if '--deploy' in sys.argv:
        deploy()
