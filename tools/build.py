"""Prepare the live tablet page for publishing.

The publish host supplies <!doctype>/<html>/<head>/<body>, so dist/index.html
keeps only their contents. All other files (CSS, JS, assets) are published
unchanged next to it.   Run:  python3 tools/build.py
"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
html = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>\s*', '', html, flags=re.I)
html = re.sub(r'<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*', '', html)
html = re.sub(r'</head>\s*<body>', '', html).replace('</body>', '').replace('</html>', '')
title = re.search(r'<title>.*?</title>', html).group(0)
html = title + '\n' + html.replace(title, '', 1).strip() + '\n'
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
open(os.path.join(ROOT, 'dist', 'index.html'), 'w', encoding='utf-8').write(html)
files = sorted(os.path.relpath(os.path.join(d, f), ROOT).replace(os.sep, '/')
               for d, _, fs in os.walk(ROOT) for f in fs
               if not any(x in d for x in ('.git', 'dist', 'tools', 'design-source'))
               and f not in ('index.html', 'README.md', '.gitignore'))
open(os.path.join(ROOT, 'dist', 'files.txt'), 'w').write('\n'.join(files) + '\n')
print('dist/index.html ready;', len(files), 'supporting files')
