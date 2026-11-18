"""Write qr-studio-midnight.css: QR Studio's Midnight (Update Pack 7, L1: the screens 01_QR-Studio_Midnight and
02_Event-QR_Midnight, "using the Orders Midnight values (Pack 4)").

Run it after any colour change in qr-studio.css:   python3 tools/qr_midnight.py

How it works
 1. Every rule in qr-studio.css that sets a colour gets a Midnight twin, scoped to html[data-app-theme="midnight"]
    .qr-studio-app, each colour taken from the pack's screens by what it colours: SURFACE for backgrounds, TEXT for words
    and icons, LINE for borders, rings and lines (a Light colour becomes the colour the Midnight screens draw where the
    Light screens draw it). A colour with none of its own here stays as it is (listed when the script runs).
 2. What prints stays paper (L1): the card previews, and every QR code on white so it scans: PAPER lists them.
 3. TOKENS last: exact colours where one Light colour turns two ways (a picked pill or chip goes light with dark words).
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import midnight as M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OUT = os.path.join(ROOT, 'qr-studio.css'), os.path.join(ROOT, 'qr-studio-midnight.css')
P = 'html[data-app-theme="midnight"]'
APP = '.qr-studio-app'

# ---------- the pack's Midnight colours for the colours QR Studio uses (measured on the Light and Midnight screens) ----------
# (page #0B1220, panels #121B2D, raised #1B2539, lines #28344C, words #F1F4FA / #C5CEDD / #8D97AB, picked #E9EEF8 with
# dark words, blue #2F6FDE (buttons) / #8FB2FF (links), teal words #6FB5A8)
SURFACE = {
  '#FFFFFF': '#121B2D', '#FEFEFE': '#121B2D', '#F3F4F7': '#0B1220', '#F3F4F6': '#1B2539', '#F1EFEB': '#1B2539', '#F5F4F2': '#1B2539',
  '#ECEAE6': '#1B2539', '#F7F6F4': '#1B2539', '#F7F8FA': '#1B2539', '#F5F8FF': '#1B2539', '#F1F0EE': '#1B2539', '#F3F1EE': '#1B2539',
  '#E7E4DF': '#1B2539', '#FAFAF9': '#1B2539', '#F4F3F2': '#1B2539', '#F5F5F4': '#1B2539', '#E9E8E7': '#1B2539', '#E8E7E5': '#1B2539',
  '#E7E5E4': '#28344C', '#D6D3D1': '#28344C', '#E2E2E2': '#1B2539',
  '#EEF4FF': '#162B54', '#E3ECFC': '#162B54', '#F0FDF4': '#123D24', '#E7F5EC': '#123D24', '#E7F6EC': '#123D24', '#DCFCE7': '#123D24',
  '#FEF2F2': '#3A1515', '#FEE2E2': '#3A1515', '#FDECEC': '#3A1515', '#FFF7ED': '#3A2A08', '#FDEBD8': '#3A2A08',
  '#E6F4F1': '#14302D', '#F3FAF8': '#14302D', '#CDEBE4': '#14302D',
  '#292524': '#E9EEF8', '#1C1917': '#E9EEF8',
  '#1E4FB8': '#2F6FDE', '#2F6FE4': '#2F6FDE', '#2F6FDE': '#2F6FDE', '#0F766E': '#0F766E', '#16A34A': '#16A34A', '#15803D': '#15803D',
  '#D92D20': '#D92D20', '#DC2626': '#DC2626', '#B91C1C': '#B91C1C', '#F7F4EE': '#F7F4EE'}
TEXT = {
  '#1C1917': '#F1F4FA', '#292524': '#F1F4FA', '#44403C': '#C5CEDD', '#57534E': '#A3ADBF', '#78716C': '#8D97AB', '#726F6C': '#8D97AB',
  '#A8A29E': '#7A869C', '#B3AEAB': '#6B778D', '#C4C0BC': '#7A869C', '#9A9895': '#7A869C', '#D6D3D1': '#5A6782',
  '#1E4FB8': '#8FB2FF', '#3C67C2': '#7D9DE5', '#1E3A8A': '#8FB2FF', '#2F6FE4': '#8FB2FF', '#2F6FDE': '#8FB2FF',
  '#0F766E': '#6FB5A8', '#115E59': '#8FD0C3',
  '#166534': '#7EE2A8', '#15803D': '#7EE2A8', '#1B7A3E': '#7EE2A8', '#14532D': '#7EE2A8',
  '#B91C1C': '#FFB0B0', '#991B1B': '#FFB0B0', '#7F1D1D': '#FFB0B0', '#9A3412': '#FFA066', '#C2410C': '#FFA066', '#7C2D12': '#FFA066',
  '#FFFFFF': '#FFFFFF'}
LINE = {
  '#D6D3D1': '#28344C', '#E2DFDA': '#28344C', '#CFCAC2': '#28344C', '#E7E5E4': '#28344C', '#BDB7AE': '#28344C', '#C4C0BC': '#28344C',
  '#E2E4E8': '#28344C', '#F0EFED': '#28344C', '#E8E7E5': '#28344C', '#E2E3E5': '#28344C', '#E1E2E6': '#28344C', '#DDDEE2': '#28344C',
  '#DDDEE1': '#28344C', '#E7E7E9': '#28344C', '#E2E5EA': '#28344C', '#E9E8E7': '#28344C', '#D1D0CE': '#28344C', '#D4D5D8': '#28344C',
  '#ECEAE6': '#28344C', '#F5F4F2': '#28344C', '#E2E2E2': '#28344C',
  '#9DBCF2': '#35579A', '#9ED3C8': '#2C6B62', '#FCA5A5': '#8A3434', '#F3C2C2': '#8A3434', '#FCA8A8': '#8A3434',
  '#BBF7D0': '#2E7D4F', '#BFE5CB': '#2E7D4F', '#F5C27A': '#7A5A1C',
  '#292524': '#E9EEF8', '#1C1917': '#E9EEF8', '#1E4FB8': '#2F6FDE', '#2F6FE4': '#2F6FDE', '#2F6FDE': '#2F6FDE', '#0F766E': '#0F766E',
  '#16A34A': '#16A34A', '#DC2626': '#DC2626', '#D92D20': '#D92D20', '#B91C1C': '#B91C1C', '#FFFFFF': '#121B2D'}

# ---------- what stays paper (L1): the printed card's preview, and the QR codes on white ----------
PAPER = ('.qrs-card', '.qrs-qr')
MISSING = {}

def hexof(c): return '#%02X%02X%02X' % tuple(int(round(v)) for v in c[:3])
def swap(v, table, kind):
    def one(m):
        c = M.parse(m.group(0))
        if not c or c[3] == 0: return m.group(0)
        h = hexof(c)
        # (a see-through colour over the page: a dark dimming gets deeper, a light one stays as it is)
        if kind == 'surface' and c[3] < 0.9:
            r, g, b = c[:3]
            return M.fmt((0, 0, 0, min(.7, c[3] * 2))) if max(r, g, b) < 80 else m.group(0)
        if h in table:
            d = M.parse(table[h])
            return M.fmt(d[:3] + (c[3],))
        r, g, b = c[:3]
        if kind == 'shadow' and max(r, g, b) < 60: return M.fmt((0, 0, 0, min(1, c[3] * 2.4)))   # (shadows: deeper on the dark)
        if kind == 'shadow' and min(r, g, b) > 200: return M.fmt((255, 255, 255, min(.16, c[3])))
        MISSING.setdefault((kind, h), 0); MISSING[(kind, h)] += 1
        return m.group(0)
    return M.COLOR_RE.sub(one, v)

PROPS = {'color': ('text', TEXT), 'fill': ('text', TEXT), 'stroke': ('text', TEXT), 'caret-color': ('text', TEXT),
         'background': ('surface', SURFACE), 'background-color': ('surface', SURFACE), 'background-image': ('surface', SURFACE),
         'border': ('line', LINE), 'border-top': ('line', LINE), 'border-right': ('line', LINE), 'border-bottom': ('line', LINE),
         'border-left': ('line', LINE), 'border-color': ('line', LINE), 'border-top-color': ('line', LINE), 'border-right-color': ('line', LINE),
         'border-bottom-color': ('line', LINE), 'border-left-color': ('line', LINE), 'outline': ('line', LINE), 'outline-color': ('line', LINE),
         '--bt': ('line', LINE), 'box-shadow': ('shadow', LINE), 'text-decoration-color': ('text', TEXT)}

def scope(s):
    m = re.match(r'html((?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*)\s+(.*)', s)       # html[data-nav="bar"] .x
    if m: return f'{P}{m.group(1)} {APP} {m.group(2)}'
    if s.startswith((APP, 'dialog' + APP)): return f'{P} {s}'                      # (the app itself)
    return f'{P} {APP} {s}'
def twins():
    css = open(SRC, encoding='utf-8').read(); blocks = []
    for ctx, sels, decls in M.rules(css):
        if any('print' in c for c in ctx): continue
        out_sels = [s for s in sels if not any(k in s for k in PAPER)]
        if not out_sels: continue
        out = []
        for p, v in decls:
            p = p.lower()
            if p not in PROPS or not M.COLOR_RE.search(v): continue
            kind, table = PROPS[p]
            # (a colour that stays is written too, so the twins keep the light rules' cascade: .on over its base)
            out.append(f'{p}:{swap(v, table, kind)}')
        if out:
            rule = ','.join(scope(s) for s in out_sels) + '{' + ';'.join(out) + '}'
            for c in reversed(ctx): rule = f'{c}{{{rule}}}'
            blocks.append(rule)
    return blocks

# ---------- the exact colours (the pack's screens) where a Light colour turns two ways ----------
def tokens():
    out = []
    def R(sels, *decls): out.append(','.join(scope(x.strip()) for x in sels.split(',')) + '{' + ';'.join(f'{p}:{v}' for p, v in decls) + '}')
    DARK = '#0B1220'
    # picked: light with dark words (the pills, area chips, picks, the help button, a category)
    R('.qrs-pill.on,.qrs-chip.on,.qrs-pick.on,.qrs-help.on,.qrs-mcat.on', ('color', f'{DARK}!important'))
    R('.qrs-pill.on .qrs-pill-i,.qrs-mcat.on small', ('color', DARK))
    R('.qrs-pill.on .qrs-pill-n', ('background', 'rgba(11,18,32,.12)'), ('color', DARK))
    # a table's QR: on its white plate, inset in its dark box behind a line
    R('.qrs-tqr', ('background', '#FFFFFF'), ('border-color', '#28344C'), ('box-shadow', 'inset 0 0 0 calc(4 * var(--fu)) #121B2D'))
    return out

HEAD = '''/* Midnight: QR Studio's dark theme (Update Pack 7, L1: 01_QR-Studio_Midnight, 02_Event-QR_Midnight). Home on Aurora
   Dark: the apps use Midnight (themes.js sets html[data-app-theme]). Written by tools/qr_midnight.py from qr-studio.css:
   change qr-studio.css and run it again rather than editing the colours here. The printed cards' previews stay paper,
   and every QR code sits on white so it scans. */
/* While QR Studio is open: the banner on the page's navy with a hairline and the top bar's shadow (as Orders), the swipe
   handle and the lock button */
{P}:has(dialog.qr-studio-app[open]){{--bar-bg:#0B1220;--bar-blur:none;--bar-line:#1F2A40;--bar-shadow:0 calc(1 * var(--bn-u)) 0 #1F2A40,0 calc(6 * var(--bn-u)) calc(20 * var(--bn-u)) rgba(0,0,0,.45);--bar-text:#F1F4FA;--bar-muted:#C5CEDD;--bar-mark-bg:#D9DFEA;--bar-mark-text:#0B1220;--bar-bat-low-bg:#4A1414;--bar-bat-low:#FF9C9C;--bar-bat-charge:#7EE2A8;--bar-bat-bolt:#0B1220;--bar-pill-bg:#1B2539;--bar-pill-edge:rgba(255,255,255,.06);--bar-pill-text:#F1F4FA;--bar-dot:#16A34A;--bar-off-bg:#3A2008;--bar-off-edge:#7A4A1C;--bar-off-dot:#FFA066;--bar-off-text:#FFC48A}}
{P}:has(dialog.qr-studio-app[open]) .home-indicator{{background:rgba(233,238,248,.35)}}
{P}:not([data-nav="bar"]):has(dialog.qr-studio-app[open]) .system-lock{{background:#1E2A42;color:#F5F5F4;box-shadow:inset 0 0 0 calc(1.5 * var(--fu)) rgba(255,255,255,.18),0 calc(6 * var(--fu)) calc(16 * var(--fu)) rgba(0,0,0,.5)}}
{P}:not([data-nav="bar"]):has(dialog.qr-studio-app[open]) .system-lock:active{{background:#000000}}
{P} {APP}{{color-scheme:dark}}
'''
def write():
    css = (HEAD.format(P=P, APP=APP) + '/* ----- the light rules, turned Midnight ----- */\n' + '\n'.join(twins()) +
           "\n/* ----- exact colours where a Light colour turns two ways ----- */\n" + '\n'.join(tokens()) + '\n')
    open(OUT, 'w', encoding='utf-8').write(css)
    print(os.path.basename(OUT) + ':', css.count('\n'), 'lines,', len(css), 'bytes')
    if MISSING: print('kept as they are:', ', '.join(f'{k[0]} {k[1]}×{n}' for k, n in sorted(MISSING.items())))
if __name__ == '__main__':
    write()
