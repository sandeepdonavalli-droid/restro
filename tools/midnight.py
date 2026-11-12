"""Write counter-midnight.css: the Counter's Midnight theme (Update Pack 2, 01_Dark-Theme-Midnight).

Run it after any colour change in counter.css:   python3 tools/midnight.py

How it works
 1. Every rule in counter.css that sets a colour gets a Midnight twin, scoped to html[data-app-theme="midnight"] .counter-app,
    its colours turned by the pack's rule (01_Dark-Theme-Midnight/05_html-reference/midnight-transform-reference.js):
    near-white surfaces become the navy panels, dark text light, coloured text lighter, light lines the hairline, light
    gradients go. Colours that don't change are written too, so the twins keep the light cascade.
    Where an element sits changes how its colour turns (inside a light-tinted chip, inside a dark one, a large panel):
    tools/midnight-contexts.json lists the selectors that aren't what their own rule suggests (measured on the screens).
 2. Icons take their colour turned twice (--ink2), as in the pack's screens: a little quieter than the words beside them.
 3. The pack's tokens (03_specs/midnight-theme-tokens.json) last: exact colours for the coloured chips, the quantity, the
    pop-ups, what is selected, the totals, the message bar, the banner, the swipe handle and the lock button.
"""
import json, math, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OUT = os.path.join(ROOT, 'counter.css'), os.path.join(ROOT, 'counter-midnight.css')
CONTEXTS = json.load(open(os.path.join(ROOT, 'tools', 'midnight-contexts.json'), encoding='utf-8'))
P = 'html[data-app-theme="midnight"]'

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
    css = css[:css.index('/* ---------- Print bill')]          # (the printed bill stays black on white)
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
def scope(s):
    m = re.match(r'html((?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*)\s+(.*)', s)       # html[data-nav="bar"] .x
    if m: return f'{P}{m.group(1)} ' + (m.group(2) if m.group(2).startswith(('.counter-app', 'dialog.counter-app')) else f'.counter-app {m.group(2)}')
    return f'{P} {s}' if s.startswith(('.counter-app', 'dialog.counter-app')) else f'{P} .counter-app {s}'
def twin(sel, decls):
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
            m1 = map_text(c, ctx); m2 = m1 if ctx in ('inv-self', 'inv-desc') else map_text(m1, ctx)
            if '::placeholder' in sel: m1 = m2                     # (hints too, as in the pack's screens)
            out += [('color', fmt(m1) + imp), ('--ink2', fmt(m2))]
        elif p in ('background', 'background-color', 'background-image'):
            cols = colours(v)
            if p != 'background-image':
                if re.search('currentcolor', v, re.I): out.append(('background-color', 'currentcolor' + imp))
                elif cols: out.append(('background-color', fmt(map_bg(cols[-1], big)) + imp))
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
        elif p == 'fill' and parse(v): out.append(('fill', fmt(map_text(parse(v), ctx)) + imp))
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
    return out

HEAD = '''/* Midnight: the Counter's dark theme (Update Pack 2, 01_Dark-Theme-Midnight). Home on Aurora Dark: the apps use Midnight
   (themes.js sets html[data-app-theme]); only the Counter has it so far, the other apps stay Light until theirs is designed.
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
if __name__ == '__main__':
    t = lambda h: fmt(map_text(parse(h)))
    head = HEAD.format(P=P, text=t('#1C1917'), muted=t('#44403C'), lowbg=fmt(map_bg(parse('#FEE2E2'))), low=t('#B91C1C'), charge=t('#15803D'))
    blocks = twins()
    css = (head + '/* ----- the light rules, turned Midnight ----- */\n' + '\n'.join(blocks) +
           "\n/* ----- the pack's tokens: exact colours that win over the turned ones ----- */\n" + '\n'.join(tokens()) + '\n')
    open(OUT, 'w', encoding='utf-8').write(css)
    print('counter-midnight.css:', len(blocks), 'rules turned,', len(css), 'bytes')
