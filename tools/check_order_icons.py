#!/usr/bin/env python3
"""Order-type icons: one set, in one place (Update Pack 5, Icon Pack 1).

Fails (exit 1) when
  - an order type's icon is drawn anywhere but order-type-icons.js (so no screen can pick its own), or
  - one of the old icons comes back: the round table (Counter Update 7), the second Takeaway bag (Orders), the scooter
    and the old Online phone (first Counter), or the earlier Orders motorbike.
Run before every publish:  python3 tools/check_order_icons.py
"""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = 'order-type-icons.js'
# the start of each path: enough to know it anywhere
OLD = {
    'round table (Counter U7)': 'm260-211 40-99q9-23 29-36.5t45-13.5h66v-161',
    'Takeaway bag used in Orders': 'M240-80q-33 0-56.5-23.5T160-160v-480q0-33 23.5-56.5T240-720h80q0-66',
    'scooter (first Counter)': 'M280-200q-50 0-85-35t-35-85h-40q-17 0-28.5-11.5T80-360v-80',
    'old Online icon (first Counter)': 'M320-80q-17 0-28.5-11.5T280-120v-640q0-17 11.5-28.5T320-800h80v-40',
    'earlier Orders motorbike (two_wheeler)': 'M20 11c-.18 0-.36.03-.53.05L17.41 9H19',
}
home = open(os.path.join(ROOT, HOME), encoding='utf-8').read()
SET = {name: re.search(name + r": \{ box: [^,]+, d: '([^']{40})", home).group(1) for name in ('dineIn', 'table', 'takeaway', 'delivery', 'phone', 'online')}
problems = []
for d, _, files in os.walk(ROOT):
    if any(part in d for part in ('.git', 'dist', 'tools', 'design-source')): continue
    for f in files:
        if not f.endswith(('.js', '.css', '.html', '.svg')): continue
        path = os.path.join(d, f); rel = os.path.relpath(path, ROOT)
        text = open(path, encoding='utf-8', errors='ignore').read()
        for what, sig in OLD.items():
            if sig in text: problems.append(f'{rel}: the old {what} icon')
        if rel != HOME:
            for name, sig in SET.items():
                if sig in text: problems.append(f'{rel}: draws the {name} icon itself (take it from {HOME})')
if problems:
    print('Order-type icons:', *problems, sep='\n  '); sys.exit(1)
print('Order-type icons: one set, only in', HOME)
