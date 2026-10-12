"""Bundle the project into one self-contained page: dist/restro.html.

CSS and JS are inlined in the same order as index.html, and images are
embedded as data URIs (PNG re-encoded to WebP at the same pixel size).
Run:  python3 tools/build.py
"""
import base64, io, json, os, re
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def read(p): return open(os.path.join(ROOT, p), encoding='utf-8').read()

def data_uri(path):
    full = os.path.join(ROOT, path)
    if path.endswith('.svg'):
        return 'data:image/svg+xml;base64,' + base64.b64encode(open(full, 'rb').read()).decode()
    buf = io.BytesIO()
    Image.open(full).save(buf, 'WEBP', quality=88, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()

html = read('index.html')
# Inline stylesheets
html = re.sub(r'<link rel="stylesheet" href="([^"]+)">',
              lambda m: '<style>\n' + read(m.group(1)) + '</style>', html)
# Inline scripts; replace the asset path map with embedded images
def script(m):
    src = m.group(1)
    if src == 'js/assets.js':
        paths = json.loads(re.search(r'=\s*(\{.*\});', read(src), re.S).group(1))
        body = 'window.RestroPreviewAssets=' + json.dumps({k: data_uri(v) for k, v in paths.items()}) + ';'
    else:
        body = read(src).replace('</script', '<\\/script')
    return '<script>\n' + body + '\n</script>'
html = re.sub(r'<script src="([^"]+)"></script>', script, html)

# The publish host supplies doctype/html/head/body; keep only their contents.
html = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>', '', html, flags=re.I)
html = re.sub(r'<meta charset[^>]*>\s*<meta name="viewport"[^>]*>', '', html)
html = html.replace('</head>', '').replace('</html>', '')
html = re.sub(r'<body>', '', html, count=1).replace('</body>', '')
# Title must sit near the top of the file
title = re.search(r'<title>.*?</title>', html).group(0)
html = title + '\n' + html.replace(title, '', 1).strip() + '\n'

os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
out = os.path.join(ROOT, 'dist', 'restro.html')
open(out, 'w', encoding='utf-8').write(html)
print(f'Built {out} ({len(html)/1e6:.1f} MB)')
