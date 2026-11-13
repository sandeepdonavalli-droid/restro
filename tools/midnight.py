"""Write counter-midnight.css and orders-midnight.css: the Counter's Midnight theme (Update Pack 2, 01_Dark-Theme-Midnight)
and the Orders app's (Update Pack 4, 01_Orders: 02_screens-midnight, 03_specs/midnight-stylesheets).

Run it after any colour change in counter.css or orders.css:   python3 tools/midnight.py   (both)
                                                                python3 tools/midnight.py counter | orders

How it works
 1. Every rule in counter.css (orders.css) that sets a colour gets a Midnight twin, scoped to html[data-app-theme="midnight"]
    .counter-app (.orders-app),
    its colours turned by the pack's rule (01_Dark-Theme-Midnight/05_html-reference/midnight-transform-reference.js):
    near-white surfaces become the navy panels, dark text light, coloured text lighter, light lines the hairline, light
    gradients go. Colours that don't change are written too, so the twins keep the light cascade.
    Where an element sits changes how its colour turns (inside a light-tinted chip, inside a dark one, a large panel):
    tools/midnight-contexts.json lists the selectors that aren't what their own rule suggests (measured on the screens).
 2. (Counter) Icons take their colour turned twice (--ink2), as in the pack's screens: a little quieter than the words beside them.
 3. The pack's tokens (03_specs/midnight-theme-tokens.json) last: exact colours for the coloured chips, the quantity, the
    pop-ups, what is selected, the totals, the message bar, the banner, the swipe handle and the lock button.
    For Orders: the same tokens as the pack's Midnight stylesheets and screens give them (orders_tokens), on our classes.
"""
import json, math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = 'html[data-app-theme="midnight"]'
# Each app: its stylesheet, the Midnight one written from it, the app's class, where its screen rules end (the printed bill
# stays black on white), and the selectors whose colour turns as another context's (tools/midnight-contexts.json)
APPS = {
  'counter': {'src': 'counter.css', 'out': 'counter-midnight.css', 'cls': '.counter-app', 'cut': '/* ---------- Print bill'},
  'orders': {'src': 'orders.css', 'out': 'orders-midnight.css', 'cls': '.orders-app', 'cut': None},
}
ALL_CONTEXTS = json.load(open(os.path.join(ROOT, 'tools', 'midnight-contexts.json'), encoding='utf-8'))
def use(app):
    global APP, SRC, OUT, CLS, CUT, CONTEXTS
    APP, cfg = app, APPS[app]
    SRC, OUT, CLS, CUT = os.path.join(ROOT, cfg['src']), os.path.join(ROOT, cfg['out']), cfg['cls'], cfg['cut']
    CONTEXTS = ALL_CONTEXTS.get('@orders', {}) if app == 'orders' else {k: v for k, v in ALL_CONTEXTS.items() if not k.startswith('@')}
use('counter')

# ---------- colours ----------
PAL = {'bg': (11, 18, 32), 's1': (18, 27, 45), 's2': (27, 37, 57), 'line': (40, 52, 76)}
def jsround(x): return math.floor(x + 0.5)
def hsl(r, g, b):
    r /= 255; g /= 255; b /= 255; mx = max(r, g, b); mn = min(r, g, b); h = s = 0; l = (mx + mn) / 2
    if mx != mn:
        d = mx - mn; s = d / (2 - mx - mn) if l > .5 else d / (mx + mn)
        if mx == r: h = (g - b) / d + (6 if g < b else 0)
        elif mx == g: h = (b - r) / d + 2
        else: h = (r - g) / d + 4
        h /= 6
    return h, s, l
def from_hsl(h, s, l):
    def f(n):
        k = (n + h * 12) % 12; a = s * min(l, 1 - l)
        return jsround(255 * (l - a * max(-1, min(k - 3, 9 - k, 1))))
    return (f(0), f(8), f(4))
NAMED = {'white': (255, 255, 255, 1), 'black': (0, 0, 0, 1), 'transparent': (0, 0, 0, 0)}
def parse(c):
    c = c.strip().lower()
    if c in NAMED: return NAMED[c]
    m = re.fullmatch(r'#([0-9a-f]{3,8})', c)
    if m:
        h = m.group(1)
        if len(h) in (3, 4): h = ''.join(ch * 2 for ch in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16) / 255 if len(h) == 8 else 1)
    m = re.fullmatch(r'rgba?\(([^)]*)\)', c)
    if m:
        parts = [x for x in re.split(r'[\s,/]+', m.group(1).strip()) if x]
        vals = [float(x[:-1]) * 2.55 if x.endswith('%') else float(x) for x in parts[:3]]
        a = parts[3] if len(parts) > 3 else '1'; a = float(a[:-1]) / 100 if a.endswith('%') else float(a)
        return (vals[0], vals[1], vals[2], a)
    return None
def fmt(c):
    r, g, b = [int(round(v)) for v in c[:3]]; a = c[3] if len(c) > 3 else 1
    return '#%02X%02X%02X' % (r, g, b) if a >= 1 else f'rgba({r},{g},{b},{round(a, 3):g})'
COLOR_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b')

def is_tint(c):
    if not c or c[3] <= 0.5: return False
    h, s, l = hsl(*c[:3]); return (0.8 < l <= 0.93 and s >= 0.18) or (l > 0.93 and s >= 0.35)
def is_inverted(c):
    if not c or c[3] <= 0.5: return False
    h, s, l = hsl(*c[:3]); return s < 0.18 and l < 0.2
def map_bg(c, big=False):
    # surfaces: near-white to the navy panels (s1, s2, or the page for a large one), a light tint to a deep one of its hue,
    # a dark grey to light; the light dimming behind pop-ups to the deeper Midnight one
    if c[3] < 0.6 and tuple(round(x) for x in c[:3]) == (15, 23, 42): return (0, 0, 0, .58)
    h, s, l = hsl(*c[:3])
    if s < 0.18 or (l > 0.93 and s < 0.35):
        if l >= 0.985: return PAL['s1'] + (c[3],)
        if l >= 0.93: return (PAL['bg'] if big else PAL['s2']) + (c[3],)
        if l >= 0.80: return PAL['s2'] + (c[3],)
        if l < 0.2: return (240, 240, 238, c[3])
        return c
    if l > 0.80: return from_hsl(h, min(.62, s), 0.16 if 0.07 < h < 0.17 else 0.21) + (c[3],)
    return c
def map_text(c, ctx='plain'):
    # text: dark greys to light, mid greys to a quiet grey, dark colours lighter; inside a light tint brighter still; in a
    # dark (now light) chip, near black; inside one, as it was
    if ctx == 'inv-self': return (20, 20, 22, 1)
    if ctx == 'inv-desc': return c
    h, s, l = hsl(*c[:3])
    if ctx == 'tint' and s >= 0.2: return from_hsl(h, 0.95, 0.74 if 0.07 < h < 0.17 else 0.84) + (1,)
    if s < 0.2:
        if l < 0.6: return from_hsl(h, s * .3, min(.97, 1.06 - l * 0.8)) + (c[3],)
        if l > 0.95: return c
        return from_hsl(h, s * .3, .62) + (c[3],)
    if l < 0.55: return from_hsl(h, min(.9, s), 0.74) + (c[3],)
    return c
def map_border(c):
    h, s, l = hsl(*c[:3])
    return PAL['line'] + (c[3],) if c[3] > 0 and s < 0.25 and l > 0.6 else c
def map_shadow(v):
    def one(m):
        c = parse(m.group(0))
        if not c: return m.group(0)
        h, s, l = hsl(*c[:3]); al = c[3]
        if s < 0.25 and l < 0.3: return f'rgba(255,255,255,{min(.16, al * 1.6):.3f})'
        if s < 0.25 and l > 0.8: return fmt(PAL['line'] + (al,))
        if l > 0.6: return fmt(from_hsl(h, 0.65, 0.45) + (min(1, al),))
        return m.group(0)
    return COLOR_RE.sub(one, v)

# ---------- Orders (Update Pack 4): the pack's own Midnight colours for the colours Orders uses ----------
# 01_Orders/03_specs/midnight-stylesheets and README §8: navy-tinted text (#F1F4FA, #C5CEDD, #8D97AB), the page #0B1220,
# panels #121B2D, raised #1B2539, the status and payment colours. Everything else takes the general transform.
O_TEXT = {'#1C1917': '#F1F4FA', '#292524': '#F1F4FA', '#44403C': '#C5CEDD', '#57534E': '#C5CEDD', '#78716C': '#8D97AB',
  '#A8A29E': '#5A6782', '#C4C0BC': '#5A6782', '#C9C5C1': '#4F5B76', '#D1D0CE': '#4F5B76',
  '#EA580C': '#FFA066', '#C2410C': '#FFA066', '#2F7D4F': '#7EE2A8', '#15803D': '#8CF0B4', '#8A3F9A': '#E7B2F2', '#5B2A6B': '#E9D3F0',
  '#4A9468': '#9CCFB0', '#2F7A4C': '#9CCFB0', '#66605B': '#5A6782', '#625C57': '#8D97AB', '#D92D20': '#FF9C9C', '#B42318': '#FFB0B0', '#DC2626': '#FF9C9C', '#1E4FB8': '#C9DBFF', '#2F6FDE': '#8FB2FF'}
O_BG = {'#F7F6F4': '#0B1220', '#EFEDE9': '#121B2D', '#FFFFFF': '#121B2D', '#FAFAF9': '#0F1829', '#F3F1EE': '#0F1829', '#F1F0EE': '#1E2A42',
  '#EEF0F4': '#1E2A42', '#F4F3F1': '#1B2539', '#E2DFDA': '#1B2539', '#EAF1FC': '#162B54', '#F3F4F6': '#151E30', '#FDECEC': '#4A1414',
  '#F5E9F8': '#2A1D36', '#E3ECFC': '#16336B', '#292524': '#E9EEF8', '#1C1917': '#E9EEF8', '#FDF3D8': '#3A2A08', '#E3F4E8': '#123D24',
  '#2F6FDE': '#2F6FDE', '#DC2626': '#DC2626', '#1F2937': '#25324D', '#E7E5E4': '#1E2A42', '#FEF7EE': '#24190D', '#F5F4F2': '#0F1829',
  '#F7F7F5': '#0F1829', '#E7F6EC': '#123D24', '#E5E7EB': '#1E2A42', '#DCE8FB': '#16336B', '#F1EFEC': '#1E2A42', '#F3F1ED': '#1B2539',
  '#EEEDEA': '#28344C', '#E7E5E1': '#1E2A42', '#F3F4F7': '#141E33', '#FDE2E2': '#4A1414', '#FFE7E5': '#3A1414', '#EFF1F3': '#151E30',
  '#DAD6D1': '#28344C', '#86E0AE': '#7EE2A8', '#F8A9AC': '#FF9C9C'}
def hexof(c): return '#%02X%02X%02X' % tuple(int(round(v)) for v in c[:3])
def exact_text(c): return APP == 'orders' and hexof(c) in O_TEXT
def text_of(c, ctx):
    if exact_text(c): return parse(O_TEXT[hexof(c)])[:3] + (c[3],)
    return map_text(c, ctx)
def bg_of(c, big):
    if APP == 'orders' and hexof(c) in O_BG: return parse(O_BG[hexof(c)])[:3] + (c[3],)
    return map_bg(c, big)

# ---------- reading counter.css ----------
PURE = {'bg': '#ffffff', 'bg-top': '#ffffff', 'bg-end': '#ffffff', 'text': '#1f2933', 'muted': '#6b7280', 'tile-top': '#ffffff',
  'tile-bottom': '#ffffff', 'edge': '#cbcfd5', 'card-middle': '#ffffff', 'panel': '#ffffff', 'panel-top': '#ffffff', 'panel-edge': '#cbcfd5',
  'line': '#cbcfd5', 'bar': '#1f2933', 'bar-top': '#27313b', 'bar-line': '#27313b', 'accent': '#1f2933', 'accent-top': '#374151',
  'accent-ink': '#1f2933', 'on-accent': '#ffffff', 'dot': '#d1d5db', 'track': '#e5e7eb', 'side-top': '#ffffff', 'side-middle': '#f9fafb',
  'side-bottom': '#e5e7eb', 'side-edge': '#cbcfd5', 'edge-glow': '#cbcfd544', 'highlight': '#ffffffbb', 'shadow': '#0000001a',
  'soft-shadow': '#00000012', 'accent-wash': '#f3f4f6', 'backdrop': '#11182770'}   # the pages' colours (themes.js PURE)
PROPS = ('color', 'background', 'background-color', 'background-image', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', 'fill', 'caret-color')
def resolve(v):
    v = re.sub(r'var\(--palette-([a-z-]+)\)', lambda m: PURE[m.group(1)], v)
    def mix(m):
        c = parse(m.group(1)); p = float(m.group(2)) / 100
        return m.group(0) if not c else f'rgba({c[0]:g},{c[1]:g},{c[2]:g},{round(c[3] * p, 3):g})'
    return re.sub(r'color-mix\(in srgb,\s*([^,\s]+)\s+([\d.]+)%,\s*transparent\)', mix, v)
def split_top(text, sep):
    parts, depth, cur = [], 0, ''
    for ch in text:
        depth += {'(': 1, '[': 1, ')': -1, ']': -1}.get(ch, 0)
        if ch == sep and depth == 0: parts.append(cur); cur = ''
        else: cur += ch
    return [p.strip() for p in parts + [cur] if p.strip()]
def rules(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S); out = []
    def block(text, ctx):
        j = 0
        while True:
            k = text.find('{', j)
            if k < 0: return
            pre, depth, m = text[j:k].strip(), 1, k + 1
            while m < len(text) and depth:
                depth += {'{': 1, '}': -1}.get(text[m], 0); m += 1
            body = text[k + 1:m - 1]
            if pre.startswith(('@media', '@supports')): block(body, ctx + [pre])
            elif not pre.startswith('@'):
                out.append((ctx, split_top(pre, ','), [tuple(x.strip() for x in d.split(':', 1)) for d in split_top(body, ';') if ':' in d]))
            j = m
    block(css, []); return out
def load():
    css = open(SRC, encoding='utf-8').read()
    if CUT: css = css[:css.index(CUT)]                         # (the printed bill stays black on white)
    found = []
    for ctx, sels, decls in rules(css):
        if any('print' in c for c in ctx): continue
        decls = [(p.lower(), resolve(v)) for p, v in decls if p.lower() in PROPS]
        if decls: found.append((ctx, sels, decls))
    return found

# ---------- the twins ----------
def strip_funcs(v, names=('repeating-linear-gradient', 'linear-gradient', 'radial-gradient', 'conic-gradient', 'url', 'calc', 'var', 'image-set')):
    out, i = '', 0
    while i < len(v):
        m = re.match('(' + '|'.join(re.escape(n) for n in names) + r')\(', v[i:])
        if not m: out += v[i]; i += 1; continue
        depth, j = 1, i + len(m.group(0))
        while j < len(v) and depth: depth += {'(': 1, ')': -1}.get(v[j], 0); j += 1
        out += ' '; i = j
    return out
def colours(v): return [c for c in (parse(m.group(0)) for m in COLOR_RE.finditer(strip_funcs(v))) if c]
def grad_keep(v):   # the pack keeps a gradient only when one of its solid colours is dark
    return any(c[3] >= 1 and 20 <= round(c[0]) <= 49 for c in (parse(m.group(0)) for m in COLOR_RE.finditer(v)) if c)
KEEP = ('em.veg', 'em.non', '.cx-vn.veg em', '.cx-vn.non em')   # veg / non-veg marks: the edge as it is, the dot turned
KEEP_BG = ('.cx-sw i',)                                         # a switch's knob stays white
# (Update Pack 5, H2) Light's readability colours that Midnight doesn't take: it keeps its own
LIGHT_ONLY = ('.or-li.sel .l2', '.or-li.sel .lst .ss:not(.late):not(.rd):not(.sch)')
def scope(s):
    m = re.match(r'html((?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*)\s+(.*)', s)       # html[data-nav="bar"] .x
    if m: return f'{P}{m.group(1)} ' + (m.group(2) if m.group(2).startswith((CLS, 'dialog' + CLS)) else f'{CLS} {m.group(2)}')
    return f'{P} {s}' if s.startswith((CLS, 'dialog' + CLS)) else f'{P} {CLS} {s}'
def twin(sel, decls):
    if sel in LIGHT_ONLY: return []
    if any(k in sel for k in KEEP):
        return [d for p, v in decls if p == 'color' for c in [parse(v)] for m in [map_text(c)]
                for d in (('color', fmt(m)), ('--ink2', fmt(m)), ('border-color', fmt(c)))]
    if any(k in sel for k in KEEP_BG): decls = [(p, v) for p, v in decls if p not in ('background', 'background-color')]
    own = [colours(v)[-1] for p, v in decls if p in ('background', 'background-color') and colours(v)]
    known = CONTEXTS.get(sel, {})
    ctx = known.get('ctx') or ('inv-self' if own and is_inverted(own[-1]) else 'tint' if own and is_tint(own[-1]) else 'plain')
    big = known.get('big', False)
    out = []
    for p, v in decls:
        imp = ' !important' if v.endswith('!important') else ''
        v = v[:-len('!important')].strip() if imp else v
        if p == 'color':
            if v.lower() in ('inherit', 'currentcolor', 'initial', 'unset', 'transparent'): out.append(('color', v + imp)); continue
            c = parse(v)
            if not c: continue
            m1 = text_of(c, ctx); m2 = m1 if ctx in ('inv-self', 'inv-desc') or exact_text(c) else map_text(m1, ctx)
            if '::placeholder' in sel: m1 = m2                     # (hints too, as in the pack's screens)
            out += [('color', fmt(m1) + imp), ('--ink2', fmt(m2))]
        elif p in ('background', 'background-color', 'background-image'):
            cols = colours(v)
            if p != 'background-image':
                if re.search('currentcolor', v, re.I): out.append(('background-color', 'currentcolor' + imp))
                elif cols: out.append(('background-color', fmt(bg_of(cols[-1], big)) + imp))
                elif p == 'background' or v in ('transparent', 'none'): out.append(('background-color', 'transparent' + imp))
            if p != 'background-color':
                if 'gradient(' in v and not grad_keep(v): out.append(('background-image', 'none' + imp))
                elif re.search(r'gradient\(|url\(', v):
                    layers = re.findall(r'(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)|url\([^)]*\)', v)
                    out.append(('background-image', ', '.join(layers) + imp))
                elif p == 'background': out.append(('background-image', 'none' + imp))
        elif p in ('border', 'border-top', 'border-right', 'border-bottom', 'border-left'):
            prop, cols = p + '-color', colours(v)
            if cols: out.append((prop, fmt(map_border(cols[-1])) + imp))
            elif re.search('currentcolor', v, re.I) or v in ('0', 'none') or re.fullmatch(r'[\d.]+\w*\s+(solid|dashed|dotted)', v) or 'calc(' in v:
                out.append((prop, 'currentcolor' + imp))
        elif p.startswith('border'):
            out.append((p, ' '.join(fmt(map_border(c)) if (c := parse(x)) else x
                                    for x in re.findall(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b[a-zA-Z]+\b', v)) + imp))
        elif p == 'box-shadow': out.append(('box-shadow', map_shadow(v) + imp))
        elif p == 'caret-color': out.append(('caret-color', v + imp))     # (the Counter's own cursors hide the browser's)
        elif p == 'fill' and parse(v): out.append(('fill', fmt(text_of(parse(v), ctx)) + imp))
    return out
def twins():
    blocks = []
    for media, sels, decls in load():
        groups = {}
        for s in sels: groups.setdefault(tuple(twin(s, decls)), []).append(s)
        for decl, ss in groups.items():
            if not decl: continue
            rule = ','.join(scope(s) for s in ss) + '{' + ';'.join(f'{p}:{v}' for p, v in decl) + '}'
            for m in reversed(media): rule = m + '{' + rule + '}'
            blocks.append(rule)
    return blocks

# ---------- the tokens ----------
def U(n): return f'calc({n:g} * var(--u))'
def tokens():
    if APP == 'orders': return orders_tokens()
    out = []
    def rule(sels, decls): out.append(','.join(f'{P} .counter-app {s.strip()}' for s in sels.split(',')) + '{' + ';'.join(f'{p}:{v}!important' for p, v in decls) + '}')
    def T(sels, bg=None, fg=None, ring=''):
        # a background, no gradient, an outline (None: no shadow, '': the shadow left), the text colour for it and all in it
        d = ([('background-color', bg)] if bg else []) + [('background-image', 'none')]
        if ring is None: d.append(('box-shadow', 'none'))
        elif ring: d.append(('box-shadow', f'inset 0 0 0 {U(1.5)} {ring}'))
        rule(sels, d + ([('color', fg)] if fg else []))
        if fg: rule(','.join(s.strip() + ' *' for s in sels.split(',')), [('color', fg)])
    SEL, SELT, RAISE, EDGE = '#E9EEF8', '#0B1220', '#1E2A42', 'rgba(255,255,255,.10)'
    T('.cx-b.amber', '#3A2A08', '#FFD27A', '#B7862A')                    # order type
    T('.cx-onote:not(.empty)', '#3A2A08', '#FFD27A', '#7A5A1C')          # order-note strip
    T('.cx-pu', '#141E33', None, 'rgba(255,255,255,.08)')                # pop-ups
    T('.cx-nclr', '#0B1220', '#FFD27A', '#7A5A1C')                       # clear note
    T('.cx-b.violet', '#2A1A55', '#D9C7FF', '#6E4FC7')                   # pager
    # (the owner, 11 Nov: in Midnight every button showing a choice has its ring, the table or customer too, in a quiet slate;
    # nothing chosen, no ring; Light stays as it is, without)
    T('.cx-b.cx-who.set', None, None, '#5A6782')                          # a table or a customer chosen
    T('.cx-b.print:not(.low):not(.out):not(.off):not(:disabled)', '#1F4FB0', '#EAF1FF', '#5B8EF0')   # print
    # (11 Nov: the paper's states show in Midnight too, in the Orders pack's Midnight colours; nothing to print yet:
    # greyed, no ring, like every button with nothing chosen)
    T('.cx-b.print.low:not(:disabled)', '#3A2A08', '#FFD27A', '#B7862A')                           # paper low
    T('.cx-b.print.out:not(:disabled)', '#3A1414', '#FFB0B0', 'rgba(255,156,156,.35)')             # out of paper
    T('.cx-b.print.off:not(:disabled)', '#151E30', '#5A6782', 'rgba(255,255,255,.06)')             # printer offline
    T('.cx-b.print:disabled', '#151E30', '#5A6782', None)                                          # nothing to print
    T('.cx-b.print .cx-paper-out', '#EF4444', '#FFFFFF', None)
    T('.cx-chip.plum', '#2A1D36', '#E7B2F2', 'rgba(231,178,242,.35)')    # schedule (set): plum (Update Pack 4)
    T('.cx-prio', None, '#FF9C9C')                                       # PRIORITY in the header
    T('.cx-qb span', '#1B2C4F', '#D6E4FF', '#3E6CC9')                    # quantity badge on a dish
    T('.cx-dtag', '#123D24', '#8CF0B4', '#2E7D4F')                       # ☰ menu tags
    T('.cx-stag', '#16336B', '#BFD5FF', '#3E6CC9')
    T('.cx-ptag', '#4A1414', '#FFB0B0', '#A33A3A')
    T('.cx-ltag:not(.out)', '#123D24', '#8CF0B4', '#2E7D4F')             # dish discount on an order line
    T('.cx-mc.sp', None, '#F5C870')                                      # spice modifier
    # one quantity style: a muted navy circle, a subtle ring, a soft light-blue number (30 in the order panel, 52 in pop-ups)
    circle = [('display', 'inline-flex'), ('align-items', 'center'), ('justify-content', 'center'), ('border-radius', '999px'),
              ('background', '#1B2C4F'), ('color', '#D6E4FF'), ('box-shadow', f'inset 0 0 0 {U(1.5)} #3E6CC9')]
    rule('.cx-stp>.cx-qty', [('width', U(30)), ('min-width', U(30)), ('height', U(30)), ('font-weight', '800')] + circle)
    rule('.cx-stp', [('gap', U(2))])
    rule('.cx-rs output', [('width', U(52)), ('min-width', U(52)), ('height', U(52))] + circle)
    # unselected options in pop-ups: raised, a faint edge, white text
    for s in ('.cx-pu .cx-mo:not(.on)', '.cx-pu .cx-dqp button:not(.on)', '.cx-pu .cx-qn-chip:not(.on)',
              '.cx-pu .cx-pk:not(.on)', '.cx-pu .cx-x'): T(s, RAISE, '#FFFFFF', EDGE)
    T('.cx-pu .cx-key', RAISE, None, EDGE)
    T('.cx-dd,.cx-qd', '#0F1829', '#FFFFFF', EDGE)                       # number displays
    # white = what you picked or typed
    for s in ('.cx-dqp button.on', '.cx-qn-chip.on', '.cx-mo.on', '.cx-pk.on'): T(s, SEL, SELT, None)
    T('.cx-pk.on .cx-cb', '#2F6FDE', '#FFFFFF', None)
    T('.cx-nf-line', None, '#FFFFFF')
    T('.cx-onote:not(.empty) .cx-onote-t>span', None, '#FFFFFF')
    T('.cx-onote.empty', 'transparent', '#E6EAF2', None)
    T('.cx-onote.empty svg', None, '#AEB8CC')
    # the message bar
    T('.cx-msg', '#25324D', '#F1F4FA', None)
    rule('.cx-msg', [('box-shadow', f'0 0 0 {U(1)} rgba(255,255,255,.14),0 {U(12)} {U(30)} rgba(0,0,0,.55)')])
    rule('.cx-msg.error', [('box-shadow', f'inset {U(5)} 0 0 #EF4444,0 0 0 {U(1)} rgba(255,255,255,.14),0 {U(12)} {U(30)} rgba(0,0,0,.55)')])
    T('.cx-msg button', None, '#9DBCFF'); T('.cx-msg.error button', None, '#FFA3A3'); T('.cx-msg small', None, '#AEB8CC')
    rule('.cx-pk:not(.on) .cx-cb', [('box-shadow', f'inset 0 0 0 {U(2)} rgba(233,238,248,.45)')])   # dish picker checkbox
    T('.cx-line.sel', '#17284A', None, None)                             # the selected order line
    # totals: labels, amounts brightest, brackets and round off quietest, discount green
    T('.cx-tstack .cx-tl>span', None, '#C5CEDD'); T('.cx-tstack .cx-tl>b', None, '#F1F4FA'); T('.cx-tstack .cx-tl i', None, '#8D97AB')
    T('.cx-tstack .cx-tl.ro>span', None, '#8D97AB'); T('.cx-tstack .cx-tl.ro>b', None, '#8D97AB')
    T('.cx-tstack .cx-tl.dsc>span', None, '#7EE2A8'); T('.cx-tstack .cx-tl.dsc>b', None, '#7EE2A8')
    T('.cx-pop', '#16213A', None, None)                                  # the ☰ menu: raised, an edge, a strong shadow
    rule('.cx-pop', [('box-shadow', f'0 0 0 {U(1)} rgba(255,255,255,.10),0 {U(24)} {U(60)} rgba(0,0,0,.6)')])
    T('.cx-pl.on', SEL, SELT, None)                                      # the selected category
    T('.cx-sw:not(.on)', '#3A4560', None, None)                          # a switch off
    rule('.cx-cur,.cx-qd i,.cx-dd i', [('background', '#5B8EF0')])       # the typing cursor
    rule('.cx-card.so:active', [('box-shadow', f'inset 0 0 0 {U(2)} rgba(233,238,248,.45)')])   # a tapped sold-out dish
    rule('.ctr-sheet-wrap', [('background', 'rgba(0,0,0,.58)')])          # dimming behind the older sheets
    # Update Pack 4, Counter scheduling (02_Counter-scheduling §8): the picker #141E33 (the pop-ups'), day chips raised and the
    # picked one white, wheels #0F1829 with a blue band, the two buttons raised (too soon: #151E30 / #5A6782), the calendar
    # #16213A; the KOT line plum or a green tick; Hold greyed #151E30; Clear schedule #FF9C9C
    T('.cx-chip.hold.off', '#151E30', '#5A6782', None)
    T('.cx-kotl:not(.sent)', None, '#E7B2F2')
    T('.cx-kotl.sent', None, '#E6EAF2'); T('.cx-kotl.sent svg', None, '#7EE2A8')
    T('.cx-sd:not(.on)', RAISE, '#FFFFFF', EDGE); T('.cx-sd.on', SEL, SELT, None)
    T('.cx-wh', '#0F1829', None, EDGE); T('.cx-wh-band', '#1B2C4F', None, '#3E6CC9')
    T('.cx-wh-row', None, '#4E5971'); T('.cx-wh-row.near', None, '#C5CEDD'); T('.cx-wh-row.sel', None, '#EAF1FF')
    T('.cx-wh-row.off', None, '#4E5971')                                 # outside business hours
    T('.cx-ssum', '#0F1829', None, EDGE); T('.cx-ssum>b', None, '#FFFFFF'); T('.cx-ssum>span', None, '#E6EAF2')
    T('.cx-ssum i', None, '#E7B2F2'); T('.cx-ssum em', None, '#FF9C9C')
    T('.cx-sk', RAISE, '#FFFFFF', EDGE); T('.cx-sk small', None, '#C5CEDD')
    T('.cx-sk:disabled', '#151E30', '#5A6782', None)
    T('.cx-scal', '#16213A', None, None)
    rule('.cx-scal', [('box-shadow', f'0 0 0 {U(1)} rgba(255,255,255,.10),0 {U(18)} {U(44)} rgba(0,0,0,.6)')])
    T('.cx-scal-h b', None, '#FFFFFF'); T('.cx-scal-nav', RAISE, '#FFFFFF', None); T('.cx-scal-w span', None, '#8D97AB')
    T('.cx-scal-d', None, '#FFFFFF'); T('.cx-scal-d.off', None, '#4E5971'); T('.cx-scal-d.today', None, '#D6E4FF', '#3E6CC9')
    T('.cx-scal-d.on', '#2F6FDE', '#FFFFFF', None)
    T('.cx-sclear:not(:disabled)', None, '#FF9C9C'); T('.cx-sclear:disabled', None, '#5A6782')
    T('.cx-ssent', None, '#E6EAF2'); T('.cx-ssent svg', None, '#7EE2A8')
    T('.cx-vinfo.plum', '#2A1D36', '#E9D3F0', None); T('.cx-vinfo.plum b', None, '#E7B2F2'); T('.cx-vinfo.plum svg', None, '#E7B2F2')
    # (Update Pack 5) a payment word as Orders' Midnight shows it: Paid white, Due orange, Part paid red
    rule('.cx-steph span .cx-payw,.ctr-history-side .ctr-paid', [('color', '#F1F4FA')]); rule('.cx-steph span .cx-payw.due,.ctr-history-side .ctr-unpaid', [('color', '#FFA066')])
    rule('.cx-steph span .cx-payw.part,.ctr-history-side .ctr-unpaid.part', [('color', '#FF9C9C')])
    return out

# ---------- Orders: the pack's Midnight stylesheets (01_Orders/03_specs/midnight-stylesheets), on our classes ----------
def orders_tokens():
    out = []
    def R(sels, *decls):
        out.append(','.join(f'{P} .orders-app {x.strip()}' for x in sels.split(',')) + '{' + ';'.join(f'{p}:{v}!important' for p, v in decls) + '}')
    def T(sels, bg=None, fg=None, ring=''):
        d = ([('background-color', bg)] if bg else []) + [('background-image', 'none')]
        if ring is None: d.append(('box-shadow', 'none'))
        elif ring: d.append(('box-shadow', ring if ring.startswith(('inset', '0 ')) else f'inset 0 0 0 1px {ring}'))
        R(sels, *(d + ([('color', fg)] if fg else [])))
    B, S1, S2, LINE, HAIR = '#0B1220', '#121B2D', '#1B2539', '#28344C', '#1F2A40'
    T1, T2, T3, SEL, DARK = '#F1F4FA', '#C5CEDD', '#8D97AB', '#E9EEF8', '#0B1220'
    LATE, READY, SCHED, CLOSED, NP, REF, ACT, LINK, RAISE = '#FFA066', '#7EE2A8', '#E7B2F2', '#9CCFB0', '#FFA066', '#FF9C9C', '#2F6FDE', '#8FB2FF', '#1E2A42'
    E06, E08, E10, E12, E16 = (f'rgba(255,255,255,.{n})' for n in ('06', '08', '10', '12', '16'))
    # the page, the home button, the title
    R('.or-root', ('background-color', B))
    T('.or-home', RAISE, T1, f'inset 0 0 0 1px {E16},0 2px 4px rgba(0,0,0,.35),0 6px 16px rgba(0,0,0,.45)')
    R('.or-title h2', ('color', T1))
    # statuses and payments (README §8)
    R('.or-c.st.open .l1 b,.or-lm .lst.open b', ('color', T1)); R('.or-c.st.late .l1 b,.or-lm .lst.late b,.or-c.st .l2.late,.or-lm .lst .ss.late,.or-chd .late', ('color', LATE))
    R('.or-c.st .l2.rd,.or-lm .lst .ss.rd', ('color', READY)); R('.or-c.st .l2.sch,.or-lm .lst .ss.sch', ('color', SCHED))
    R('.or-c.st.closed .l1 b,.or-lm .lst.closed b', ('color', CLOSED)); R('.or-c.st.cancelled .l1 b,.or-lm .lst.cancelled b', ('color', REF))
    R('.or-c.pm.np .l1 b,.or-lr.np .l1 b', ('color', NP)); R('.or-c.pm.red .l1 b,.or-lr.red .l1 b', ('color', REF)); R('.or-c.pm.grey .l1 b,.or-lr.grey .l1 b', ('color', T3))
    R('.or-lm .kfl', ('color', '#FFB0B0'))
    # (Update Pack 5, H1: PQ1–PQ6 Midnight) a QR order's Pending in amber, both columns; Paid · matching's words the same
    R('.or-c.st.pending .l1 b,.or-c.pm.pend .l1 b,.or-lm .lst.pending b,.or-lr.pend .l1 b,.or-mt', ('color', '#F5B14C'))
    # code chips and boxes, discount and void marks
    T('.chip.y', '#3A2A08', '#FFD27A', '#7A5A1C'); T('.chip.g', '#123D24', '#8CF0B4', '#2E7D4F')
    # (a code the search found: marked like other found words, amber on brown inside the chip, as in K2)
    R('.chip.hit', ('box-shadow', 'inset 0 0 0 1px #2E7D4F'), ('color', '#FFD27A'), ('position', 'relative'), ('z-index', '0'))
    R('.chip.hit::before', ('content', '""'), ('position', 'absolute'), ('inset', '1px calc(7 * var(--fu))'), ('border-radius', 'calc(4 * var(--fu))'), ('background-color', '#3A2A08'), ('z-index', '-1'))
    T('.or-codes .cb', S2, None, None); R('.or-codes .cb span', ('color', T3)); R('.or-codes .cb b', ('color', T1))
    T('.or-codes .cb.y', '#3A2A08', None, '#7A5A1C'); R('.or-codes .cb.y span', ('color', '#E7C27A')); R('.or-codes .cb.y b', ('color', '#FFD27A'))
    T('.or-codes .cb.g', '#123D24', None, '#2E7D4F'); R('.or-codes .cb.g span', ('color', '#8FDDB0')); R('.or-codes .cb.g b', ('color', '#8CF0B4'))
    R('.or-codes .cb.hit', ('box-shadow', 'inset 0 0 0 2px #E2B93B'))
    T('.or-mk', S2, '#AEB8CC', E08); R('.or-mk svg,.or-mk svg *', ('fill', '#AEB8CC'))
    R('.or-root mark', ('background-color', '#3A2A08'), ('color', '#FFD27A'))
    # order-type tiles: one quiet navy tile for every type, the icon lightly tinted; partner logos toned down
    R('.or-tt', ('background-color', '#18223A'), ('box-shadow', 'inset 0 0 0 1px rgba(255,255,255,.05)'))
    # (Update Pack 5, Icon Pack 1: Online sky blue in Light, rose in Midnight)
    for light, dark in (('9A6B1F', '#B49A6E'), ('2E7D4F', '#7FAA92'), ('2F5FB3', '#8396BF'), ('6D4BC4', '#9890BE'), ('0284C7', '#C98BA5')):
        R(f'.or-tt[style*="{light}"],.or-it .ii[style*="{light}"]', ('color', dark))
    # the QR tag (Update Pack 5, K: PQ1–PQ6 Midnight) and the QR row of the Order type filter
    R('.or-qr', ('background-color', '#1B2A47'), ('border-color', '#34507F'), ('color', '#A9C2FF')); R('.or-it .ii.t.qr', ('color', '#A9C2FF'))
    R('.or-offline .or-i', ('fill', '#F5C870'))   # (the offline notice's icon keeps its amber; Due's orange is now #C2410C)
    # Today scrolling back (Update Pack 5, H3: SB1–SB6 Midnight): the day's band and its words; the cards' words on the page
    R('.or-dayd', ('background-color', '#0E1626'), ('border-color', '#22304A')); R('.or-cg .or-dayd', ('background-color', 'transparent'), ('border-color', 'transparent'))
    R('.or-dayd-in b', ('color', '#A8B3C7')); R('.or-dayd-in span', ('color', '#7E8AA0')); R('.or-tlab', ('color', '#8A96AD'))
    R('.or-tt .or-logo,.or-it .or-logo', ('filter', 'saturate(.62) brightness(.86)'))
    # the action buttons
    T('.or-b', '#162B54', '#C9DBFF', 'rgba(91,142,240,.42)')
    R('.or-b.pr', ('background-color', S1), ('background-image', f'linear-gradient(180deg,{S1} 0,{S1} var(--used,0%),#21427F var(--used,0%),#21427F 100%)'), ('box-shadow', 'inset 0 0 0 1px rgba(91,142,240,.5)'))
    T('.or-b.err', '#4A1414', '#FFB0B0', '#A33A3A'); T('.or-b.sk', '#2A1D36', '#E7B2F2', 'inset 0 0 0 1.5px rgba(231,178,242,.35)')
    T('.or-b.off,.or-b.pr.off,.or-b.pr.poff', '#151E30', '#5A6782', E06)
    R('.or-b.hit', ('box-shadow', 'inset 0 0 0 2px #E2A93B'))
    # (paper running low: an amber fill and ring, as in P07)
    R('.or-b.pr.low', ('background-color', S1), ('background-image', f'linear-gradient(180deg,{S1} 0,{S1} var(--used,0%),#5A3A07 var(--used,0%),#5A3A07 100%)'), ('box-shadow', 'inset 0 0 0 1.5px #C0924A'), ('color', '#FFE2A7'))
    T('.or-b.pr.out', '#3A1414', '#FFB0B0', 'rgba(255,156,156,.35)'); R('.or-b.pr.out::after', ('background-color', '#EF4444'))
    R('.or-b.sent::after', ('background-color', READY)); R('.or-b.failed::after', ('background-color', REF))  # (the last one didn't go: red)
    # the ring round a button at work (buzzing, its pop-up open) and the keyboard's focus ring: the brighter blue
    R('.or-b.busy,.or-b.opener,:is(.or-root,.or-scrim) button:focus-visible,.or-r:focus-visible,.or-li:focus-visible,.or-cd:focus-visible', ('outline-color', '#5B8EF0'))
    T('.or-open', ACT, '#FFFFFF', None)
    # the Sync button in its states (normal raised navy; syncing blue, synced green, waiting amber, offline grey)
    T('.sync-btn.normal', S2, T1, E08); T('.sync-btn.syncing', '#16336B', '#BFD5FF', '#3E6CC9'); T('.sync-btn.synced', '#123D24', '#8CF0B4', '#2E7D4F')
    T('.sync-btn.pending', '#3A2A08', '#FFD27A', '#7A5A1C'); R('.sync-btn-n', ('border-color', B))
    # search, Clear filters, the menus' buttons, sort
    T('.or-search', S2, T3, E08); R('.or-search-in', ('color', T1)); R('.or-search-in::placeholder', ('color', T3)); R('.or-search-i', ('fill', T3))
    T('.or-search.typed', None, None, 'inset 0 0 0 2px #5B8EF0'); R('.or-search.typed .or-search-in', ('color', '#FFFFFF'))
    T('.or-search-x', RAISE, T1, None)
    T('.or-clear', RAISE, T1, E12); T('.or-clear.off', '#151E30', '#4F5B76', E06)
    T('.or-fd,.or-dd2', S2, T1, E08); T('.or-fd.on,.or-dd2.on', '#16336B', '#BFD5FF', '#3E6CC9')
    R('.or-fd.open,.or-dd2.open', ('box-shadow', 'inset 0 0 0 2px #5B8EF0'))
    R('.or-sortd .sl', ('color', T3))
    # Classic: the sidebar, its tabs, the totals card, the table
    R('.or-side', ('background-color', S1), ('border-right-color', LINE))
    R('.or-tab', ('color', T2)); R('.or-tab em', ('background-color', S2), ('color', T2))
    T('.or-tab.on', SEL, DARK, None); R('.or-tab.on em', ('background-color', 'rgba(11,18,32,.12)'), ('color', DARK)); R('.or-tab.on .or-i', ('fill', DARK))
    R('.or-tab.or-held,.or-tab.or-held em', ('color', T2)); R('.or-hsep', ('background-color', LINE)); R('.or-flab', ('color', T3))
    T('.or-tot3', S2, None, None); R('.or-tot3 span', ('color', T3)); R('.or-tot3 b', ('color', T1)); R('.or-tot3 > *', ('border-color', LINE))
    R('.or-tot3 .due span,.or-tot3 .due b,.or-tots .due span,.or-tots .due b', ('color', NP))
    R('.or-tot3 .due.z,.or-tot3 .due.z span,.or-tot3 .due.z b,.or-tots .due.z span,.or-tots .due.z b', ('color', '#6E7891'))
    R('.or-sheet', ('background-color', S1), ('border-top-color', LINE))
    R('.or-hd', ('background-color', '#0F1829'), ('border-bottom-color', LINE), ('color', T3)); R('.or-hd .on', ('color', T1))
    R('.or-r', ('border-bottom-color', HAIR))
    # Split and Cards: the rail, the list, the totals, the order on the right, the cards
    R('.or-rail', ('background-color', S1), ('border-right-color', LINE)); R('.or-rtb', ('color', T2))
    R('.or-ri em', ('background-color', LINE), ('color', T2)); T('.or-rtb.on', SEL, DARK, None); R('.or-rtb.on .or-ri em', ('background-color', DARK), ('color', SEL)); R('.or-rtb.on .or-ri .or-i', ('fill', DARK))
    R('.or-rsep', ('background-color', LINE))
    R('.or-pane', ('background-color', S1), ('border-right-color', LINE)); R('.or-ph', ('background-color', '#0F1829'), ('border-bottom-color', LINE))
    R('.or-sorth', ('border-bottom-color', LINE), ('color', T3)); R('.or-li', ('border-bottom-color', HAIR))
    R('.or-li.sel', ('background-color', '#17284A')); R('.or-li.sel::before', ('background-color', SEL))
    R('.or-tots.foot', ('background-color', '#0F1829'), ('border-top-color', LINE)); R('.or-tots .tc', ('border-left-color', LINE))
    R('.or-tots .tc span', ('color', T3)); R('.or-tots .tc b', ('color', T1))
    R('.or-dp', ('background-color', B)); R('.or-dt', ('background-color', 'transparent'))
    R('.or-dl', ('border-top-color', LINE)); R('.or-dl .or-line,.or-dl > *', ('border-bottom-color', HAIR))
    R('.or-dtot', ('border-top-color', LINE), ('color', T2)); R('.or-dtot b,.or-dtot .g', ('color', T1))
    T('.or-tots.bar', S1, None, E08); T('.or-cd', S1, None, E06)
    # Floating pills
    R('.or-classic.pills .or-sheet,.or-classic.pills .or-hd', ('background-color', 'transparent'), ('border-color', 'transparent'))
    T('.or-classic.pills .or-r', S1, None, f'inset 0 0 0 1px {E06},0 4px 14px rgba(0,0,0,.28)'); R('.or-classic.pills .or-r', ('border-bottom-color', 'transparent'))
    R('.or-split.pills .or-pane,.or-split.pills .or-ph,.or-split.pills .or-tots.foot', ('background-color', B), ('border-color', 'transparent'))
    R('.or-split.pills .or-sorth', ('border-bottom-color', 'transparent'))
    T('.or-split.pills .or-li', S1, None, f'inset 0 0 0 1px {E06},0 4px 12px rgba(0,0,0,.25)'); R('.or-split.pills .or-li', ('border-bottom-color', 'transparent'))
    T('.or-split.pills .or-li.sel', '#17284A', None, f'inset 0 0 0 2.5px {SEL},0 4px 12px rgba(0,0,0,.3)')
    T('.or-split.pills .or-tots.foot .tc', S1, None, E06); R('.or-split.pills .or-dp', ('background-color', B))
    T('.or-split.pills .or-dt', S1, None, f'inset 0 0 0 1px {E06},0 6px 20px rgba(0,0,0,.35)')
    T('.or-cards.pills .or-cd', S1, None, f'inset 0 0 0 1px {E06},0 6px 18px rgba(0,0,0,.3)')
    # tick boxes: an outline, light when ticked (picking orders); the menus' and the KOT list's below win on their light rows
    R('.or-root .or-cb', ('background-color', 'transparent'), ('box-shadow', 'inset 0 0 0 2px rgba(233,238,248,.45)'))
    R('.or-root .or-cb.on', ('background-color', SEL), ('box-shadow', 'none'), ('color', DARK))
    # menus, the sort menu, the date pop-over and its calendar
    R('.or-scrim', ('background-color', 'rgba(0,0,0,.58)'))
    T('.or-menu,.or-datepop', '#16213A', T1, f'inset 0 0 0 1px {E10},0 24px 60px rgba(0,0,0,.6)')
    R('.or-mh,.or-mf,.or-it-t small,.or-dopt-t small,.or-dhint', ('color', T3)); R('.or-sepm', ('background-color', LINE))
    R('.or-it', ('color', T1)); R('.or-it .or-cb', ('background-color', 'transparent'), ('box-shadow', 'inset 0 0 0 2px rgba(233,238,248,.45)'))
    R('.or-it em', ('background-color', LINE), ('color', T2)); R('.or-it .ii', ('background-color', RAISE), ('color', T2)); R('.or-it .or-def', ('color', T3))
    T('.or-it.on,.or-it.or-sorti.on', SEL, DARK, None); R('.or-it.on .or-cb', ('background-color', DARK), ('box-shadow', 'none'), ('color', '#FFFFFF'))
    R('.or-it.on em', ('background-color', 'rgba(11,18,32,.12)'), ('color', DARK)); R('.or-it.on small', ('color', '#3A4560'))
    R('.or-it.on .ii:not(.t)', ('background-color', DARK), ('color', '#FFFFFF'))
    R('.or-it .ii.t,.or-it.on .ii.t', ('background-color', '#18223A'))
    T('.or-seg', '#0F1829', None, None); R('.or-seg button', ('color', T2)); T('.or-seg button.on', SEL, DARK, None)
    R('.or-dopt', ('color', T1)); T('.or-dopt.on', SEL, DARK, None); R('.or-dopt.on small', ('color', '#3A4560'))
    R('.or-rd', ('box-shadow', 'inset 0 0 0 2px rgba(233,238,248,.45)')); R('.or-rd.on', ('box-shadow', 'inset 0 0 0 calc(6.5 * var(--fu)) #0B1220'))
    T('.or-dsel', RAISE, T1, None); R('.or-dsel select', ('color', T1)); T('.or-dnav', RAISE, T1, None)
    R('.or-dweek span', ('color', T3)); R('.or-day', ('color', T1)); R('.or-day.out', ('color', '#4F5B76'))
    R('.or-day.mid::before,.or-day.first::before,.or-day.last::before', ('background-color', RAISE))
    R('.or-day.end span', ('background-color', SEL), ('color', DARK)); R('.or-day.today span::after', ('background-color', '#5B8EF0'))
    R('.or-day.end.today span::after', ('background-color', DARK))
    R('.or-dfoot', ('border-top-color', LINE)); R('.or-dshow', ('color', T2)); R('.or-dshow b', ('color', T1))
    T('.or-dcancel', RAISE, T1, None); T('.or-dgo', ACT, '#FFFFFF', None)
    # the pop-ups (Notify, KOT, Send now, paper roll, delete)
    T('.or-pop', '#141E33', T1, f'inset 0 0 0 1px {E08},0 30px 80px rgba(0,0,0,.6)')
    R('.or-pop-head h3', ('color', T1)); R('.or-pop-head p,.or-lab,.or-del-sub', ('color', T3))
    T('.or-x', RAISE, T1, None)
    T('.or-msg-box', '#0F1829', T1, E08)
    T('.or-tpl', 'transparent', T2, E16); T('.or-tpl.on', SEL, DARK, None)
    T('.or-ch.no,.or-ch.grey', RAISE, T1, E10); T('.or-ch.wa', '#123D24', '#8CF0B4', '#2E7D4F'); T('.or-ch.sm', ACT, '#FFFFFF', None)
    T('.or-go', ACT, '#FFFFFF', None); T('.or-go.red', '#DC2626', '#FFFFFF', None); T('.or-go:disabled', RAISE, '#5A6782', None)
    T('.or-kotc', RAISE, None, E10); R('.or-kotc-t b', ('color', T1)); R('.or-kotc-t small', ('color', T2)); R('.or-kotc-at', ('color', T3)); R('.or-kotc-t b i', ('color', '#FFA3A3'))
    R('.or-kotc .or-cb', ('background-color', 'transparent'), ('box-shadow', 'inset 0 0 0 2px rgba(233,238,248,.45)'))
    T('.or-kotc.on', SEL, None, None); R('.or-kotc.on .or-kotc-t b', ('color', DARK)); R('.or-kotc.on .or-kotc-t small,.or-kotc.on .or-kotc-at', ('color', '#3A4560'))
    R('.or-kotc.on .or-kotc-t b i', ('color', '#8E1B12')); R('.or-kotc.on .or-cb,.or-kotc .or-cb.on', ('background-color', DARK), ('box-shadow', 'inset 0 0 0 2px rgba(233,238,248,.45)'), ('color', '#FFFFFF'))
    T('.or-unsent', '#0F1829', T1, None); R('.or-unsent p', ('color', T1)); R('.or-unsent .mod', ('color', '#F5C870'))
    T('.or-why', '#4A1414', '#FFB0B0', None); T('.or-why.sch,.or-qwhen', '#2A1D36', '#E9D3F0', None); R('.or-qwhen b,.or-why.sch b', ('color', SCHED))
    T('.or-pop.del', '#141E33', T1, f'inset 0 0 0 1px {E08},0 30px 80px rgba(0,0,0,.6)'); T('.or-pop.del .or-x', RAISE, T1, E12)
    R('.or-del-i', ('background-color', '#4A1414')); T('.or-why.del', '#3A1216', '#FFB0B0', None)
    R('.or-dlab', ('color', T2)); R('.or-line input', ('color', '#FFFFFF')); R('.or-line input::placeholder', ('color', T3))
    R('.or-line', ('border-bottom-color', '#5B8EF0')); R('.or-line.empty:not(:focus-within)', ('border-bottom-color', '#8A3A3A')); R('.or-line .or-i', ('fill', T1))
    T('.or-rsn-c', RAISE, T1, E10); T('.or-rsn-c.on', SEL, DARK, None); R('.or-rsn-none', ('border-color', LINE), ('color', T3))
    R('.or-clear-t', ('color', T2)); R('.or-clear-t:disabled', ('color', '#4F5B76'))
    T('.or-dcancel2', RAISE, T1, E10); T('.or-dgo2', '#DC2626', '#FFFFFF', None); T('.or-dgo2:disabled', RAISE, '#5A6782', None)
    T('.or-roll-h>i', '#E9F1FC', '#1E4FB8', None); R('.or-roll-h p', ('color', T3))  # (the printer stays on its light tile, as in P08)
    # picking orders to delete
    T('.or-picked', SEL, DARK, None); R('.or-link', ('color', '#9DBCFF')); R('.or-phint', ('color', T3))
    R('.or-ptrash', ('color', '#DC2626'))
    T('.or-cancel', RAISE, T1, E10); T('.or-del', '#DC2626', '#FFFFFF', None); T('.or-del:disabled', RAISE, '#5A6782', None)
    R('.or-r.picked,.or-li.picked', ('background-color', '#17284A')); T('.or-cd.picked', '#17284A', None, f'inset 0 0 0 2.5px {SEL}')
    R('.or-plist .pr', ('border-bottom-color', LINE), ('color', T2)); R('.or-plist .pr span b,.or-plist .pr.tot', ('color', T1)); R('.or-plist .pr .am', ('color', NP))
    # empty days, no results, offline
    R('.or-empty .ei', ('background-color', S2), ('color', '#5A6782')); R('.or-empty strong', ('color', T1)); R('.or-empty p', ('color', T3)); R('.or-empty p b', ('color', T1))
    T('.or-ebtn.pri', ACT, '#FFFFFF', None); T('.or-ebtn.sec', RAISE, T1, E10)
    T('.or-offline', '#24190D', '#F5D1A8', '#5A3A16'); R('.or-offline svg,.or-offline svg *', ('fill', '#FFA066')); R('.or-offline b', ('color', '#FFE2C2'))
    T('.sync-btn.offline', '#151E30', '#7F8AA3', None)
    R('.or-mhint', ('color', T3)); R('.or-mhint b', ('color', T1))
    # the message bar
    T('.or-msg', '#25324D', T1, f'0 0 0 1px rgba(255,255,255,.14),0 12px 30px rgba(0,0,0,.55)')
    R('.or-msg.error', ('box-shadow', 'inset 4px 0 0 #EF4444,0 0 0 1px rgba(255,255,255,.14),0 12px 30px rgba(0,0,0,.55)'))
    R('.or-msg small,.or-msg-t small', ('color', '#AEB8CC')); R('.or-msg.error .or-msg-a', ('color', '#FFB8B8'))
    R('.or-msg-i', ('color', DARK))
    return out

HEAD = '''/* Midnight: the Counter's dark theme (Update Pack 2, 01_Dark-Theme-Midnight). Home on Aurora Dark: the apps use Midnight
   (themes.js sets html[data-app-theme]); the Counter and Orders have it so far (orders-midnight.css), the other apps stay
   Light until theirs is designed.
   Written by tools/midnight.py from counter.css and the pack's tokens: change counter.css and run it again rather than
   editing the colours here. */
/* Icons take their colour turned twice, as in the pack's screens: a little quieter than the words beside them */
{P} :where(.counter-app svg *:not(#system-navigation *)){{color:var(--ink2,currentColor)}}
/* (the same for the note under a dish; the pack's Backspace and empty-note icons keep the colour once turned) */
{P} .counter-app .cx-cmt span{{color:var(--ink2)}}
{P} .counter-app :is(.cx-key.fn,.cx-nl-line.empty) svg *{{color:inherit}}
/* The typing cursor is blue in every field */
{P} :where(.counter-app input,.counter-app textarea){{caret-color:#5B8EF0}}
/* While the Counter is open: the banner, the swipe handle and the lock button (60, 16 from the right, 14 from the bottom) */
{P}:has(dialog.counter-app[open]){{--bar-bg:#121B2D;--bar-blur:none;--bar-line:rgba(17,24,39,.14);--bar-shadow:0 calc(1 * var(--bn-u)) 0 var(--bar-line),0 calc(2 * var(--bn-u)) calc(4 * var(--bn-u)) rgba(17,24,39,.05),0 calc(8 * var(--bn-u)) calc(22 * var(--bn-u)) rgba(17,24,39,.10);--bar-text:{text};--bar-muted:{muted};--bar-mark-bg:#D9DFEA;--bar-mark-text:#0B1220;--bar-bat-low-bg:{lowbg};--bar-bat-low:{low};--bar-bat-charge:{charge};--bar-bat-bolt:#121B2D;--bar-pill-bg:#1B2539;--bar-pill-edge:rgba(17,24,39,.06);--bar-pill-text:{text};--bar-dot:#16A34A}}
{P}:has(dialog.counter-app[open]) #top-banner .battery>rect:first-of-type{{stroke:#1C1917}}
{P}:has(dialog.counter-app[open]) .home-indicator{{background:rgba(233,238,248,.35)}}
{P}:not([data-nav="bar"]):has(dialog.counter-app[open]) .system-lock{{background:#1E2A42;color:#F5F5F4;box-shadow:inset 0 0 0 calc(1.5 * var(--fu)) rgba(255,255,255,.18),0 calc(6 * var(--fu)) calc(16 * var(--fu)) rgba(0,0,0,.5)}}
{P}:not([data-nav="bar"]):has(dialog.counter-app[open]) .system-lock:active{{background:#000000}}
'''
ORDERS_HEAD = '''/* Midnight: the Orders app's dark theme (Update Pack 4, 01_Orders: 02_screens-midnight, 03_specs/midnight-stylesheets).
   Home on Aurora Dark: the apps use Midnight (themes.js sets html[data-app-theme]). Written by tools/midnight.py from
   orders.css and the pack's Midnight stylesheets: change orders.css and run it again rather than editing the colours here. */
/* The typing cursor is blue */
{P} :where(.orders-app input){{caret-color:#5B8EF0}}
/* While Orders is open: the banner on the page's navy with a hairline, the swipe handle and the lock button */
{P}:has(dialog.orders-app[open]){{--bar-bg:#0B1220;--bar-blur:none;--bar-line:#1F2A40;--bar-shadow:0 calc(1 * var(--bn-u)) 0 #1F2A40;--bar-text:#F1F4FA;--bar-muted:#C5CEDD;--bar-mark-bg:#D9DFEA;--bar-mark-text:#0B1220;--bar-bat-low-bg:#4A1414;--bar-bat-low:#FF9C9C;--bar-bat-charge:#7EE2A8;--bar-bat-bolt:#0B1220;--bar-pill-bg:#1B2539;--bar-pill-edge:rgba(255,255,255,.06);--bar-pill-text:#F1F4FA;--bar-dot:#16A34A;--bar-off-bg:#3A2008;--bar-off-edge:#7A4A1C;--bar-off-dot:#FFA066;--bar-off-text:#FFC48A}}
{P}:has(dialog.orders-app[open]) .home-indicator{{background:rgba(233,238,248,.35)}}
{P}:not([data-nav="bar"]):has(dialog.orders-app[open]) .system-lock{{background:#1E2A42;color:#F5F5F4;box-shadow:inset 0 0 0 calc(1.5 * var(--fu)) rgba(255,255,255,.18),0 calc(6 * var(--fu)) calc(16 * var(--fu)) rgba(0,0,0,.5)}}
{P}:not([data-nav="bar"]):has(dialog.orders-app[open]) .system-lock:active{{background:#000000}}
'''
def write(app):
    use(app)
    t = lambda h: fmt(map_text(parse(h)))
    head = (HEAD.format(P=P, text=t('#1C1917'), muted=t('#44403C'), lowbg=fmt(map_bg(parse('#FEE2E2'))), low=t('#B91C1C'), charge=t('#15803D'))
            if app == 'counter' else ORDERS_HEAD.format(P=P))
    blocks = twins()
    css = (head + '/* ----- the light rules, turned Midnight ----- */\n' + '\n'.join(blocks) +
           "\n/* ----- the pack's tokens: exact colours that win over the turned ones ----- */\n" + '\n'.join(tokens()) + '\n')
    open(OUT, 'w', encoding='utf-8').write(css)
    print(os.path.basename(OUT) + ':', len(blocks), 'rules turned,', len(css), 'bytes')
if __name__ == '__main__':
    for app in (sys.argv[1:] or ['counter', 'orders']): write(app)
