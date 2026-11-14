#!/usr/bin/env python3
"""Checks that ANDROID-BRIDGE.md covers everything the page asks of the RESTRO Android app.

It reads every script in the repository root and lists:
  - each RESTRODevice member the page uses (directly, or through a name it was saved under, such as
    `const printer = window.RESTRODevice?.printer` then `printer.printKot`);
  - each restro: window event the page listens for but never sends itself (so it can only come from the app);
  - each method of window.RestroSystem (the app calls these).
Each must appear in ANDROID-BRIDGE.md in backticks (`printer.printKot`, `getBatteryStatus`, `restro:keyboard` ...).
Prints the checklist; exits 1 when something is missing. Run it after any change to how the page talks to the app:

    python3 tools/check_bridge_doc.py
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC = ROOT / 'ANDROID-BRIDGE.md'

def strip_comments(text):
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)           # block comments
    return re.sub(r'(?m)^\s*//.*$', '', text)                   # whole-line comments

def scripts():
    for path in sorted(ROOT.glob('*.js')):
        yield path.name, strip_comments(path.read_text(encoding='utf-8'))

PARTS = ('printer', 'pager', 'sms', 'whatsapp', 'integrations', 'localSync', 'wifi', 'bluetooth', 'qr')

def members():
    found = {}  # 'printer.printKot' -> {files}
    def add(member, name): found.setdefault(member, set()).add(name)
    direct = re.compile(r'RESTRODevice\??\.(\w+)(?:\??\.(\w+))?')
    # names the bridge (or one of its parts) is saved under: const host = window.RESTRODevice; a, dev = window.RESTRODevice;
    # const host = () => window.RESTRODevice?.wifi (a helper: used anywhere in its file; a saved value: just after it)
    alias = re.compile(r'(?:\b(?:const|let|var)\s+|,\s*)(\w+)\s*=\s*(\(\)\s*=>\s*)?window\.RESTRODevice(?:\??\.(\w+))?(?=\s*[;,)])')
    for name, text in scripts():
        for m in direct.finditer(text):
            a, b = m.group(1), m.group(2)
            add(f'{a}.{b}' if b and a in PARTS else a, name)
        for m in alias.finditer(text):
            var, is_fn, part = m.group(1), bool(m.group(2)), m.group(3)
            scope = text if is_fn else text[m.end():m.end() + 2500]
            for u in re.finditer(rf'(?<![\w.]){re.escape(var)}{r"\(\)" if is_fn else ""}\??\.(\w+)(?:\??\.(\w+))?', scope):
                a, b = u.group(1), u.group(2)
                if part: add(f'{part}.{a}', name)
                else: add(f'{a}.{b}' if b and a in PARTS else a, name)
        # a saved value of a helper: const host = deviceHost()
        for f in re.finditer(r'(?:\b(?:const|let|var)\s+|,\s*)(\w+)\s*=\s*\(\)\s*=>\s*window\.RESTRODevice(?:\??\.(\w+))?(?=\s*[;,)])', text):
            for m in re.finditer(rf'(?:\b(?:const|let|var)\s+|,\s*)(\w+)\s*=\s*{re.escape(f.group(1))}\(\)(?=\s*[;,)])', text):
                for u in re.finditer(rf'(?<![\w.]){re.escape(m.group(1))}\??\.(\w+)', text[m.end():m.end() + 2500]):
                    add(f'{f.group(2)}.{u.group(1)}' if f.group(2) else u.group(1), name)
        # members looked up by name: host[method], with nativeAction('goHome') and the like
        if re.search(r'host\?\.\[method\]', text):
            for m in re.finditer(r"nativeAction\('(\w+)'\)", text): add(m.group(1), name)
    # (a part is listed through its members)
    for part in PARTS:
        if any(k.startswith(part + '.') for k in found): found.pop(part, None)
    return found

def events():
    listened, fired = {}, set()
    for name, text in scripts():
        for m in re.finditer(r"addEventListener\(\s*['\"](restro:[\w-]+)", text):
            listened.setdefault(m.group(1), set()).add(name)
        for m in re.finditer(r"\[((?:\s*['\"]restro:[\w-]+['\"]\s*,?)+)\]", text):
            for e in re.findall(r"restro:[\w-]+", m.group(1)):
                listened.setdefault(e, set()).add(name)
        fired.update(re.findall(r"(?:CustomEvent|Event|emit)\(\s*['\"](restro:[\w-]+)", text))
    return {e: f for e, f in listened.items() if e not in fired}

def system_methods():
    out = {}
    for name, text in scripts():
        m = re.search(r'window\.RestroSystem\s*=\s*Object\.freeze\(\{([^}]*)\}', text)
        if m:
            for key in re.findall(r'(\w+)\s*:', m.group(1)):
                out[f'RestroSystem.{key}'] = {name}
    return out

def documented():
    doc = DOC.read_text(encoding='utf-8')
    fences = re.findall(r'```[a-z]*\n(.*?)```', doc, flags=re.S)       # code blocks count as quoted
    inline = re.findall(r'`([^`\n]+)`', re.sub(r'```.*?```', '', doc, flags=re.S))
    return doc, inline + fences

def main():
    doc, quoted = documented()
    def covered(name):
        if any(name in q for q in quoted): return True
        if '.' in name:  # a part's member: in its part's section, as `member(...)` or `member`
            part, member = name.split('.', 1)
            in_part = any(f'RESTRODevice.{part}' in q for q in quoted)
            return in_part and any(re.match(rf'{re.escape(member)}\b', q) or f'{part}.{member}' in q for q in quoted)
        return False
    rows, missing = [], []
    for title, items in (('RESTRODevice members', members()), ('Events from the app', events()), ('Called by the app', system_methods())):
        rows.append(f'{title}:')
        for name in sorted(items):
            ok = covered(name)
            rows.append(f"  {'ok     ' if ok else 'MISSING'}  {name:34} {', '.join(sorted(items[name]))}")
            if not ok: missing.append(name)
        rows.append('')
    print('ANDROID-BRIDGE.md against the code\n\n' + '\n'.join(rows))
    print('All covered.' if not missing else f'{len(missing)} missing: ' + ', '.join(missing))
    return 1 if missing else 0

if __name__ == '__main__':
    sys.exit(main())
