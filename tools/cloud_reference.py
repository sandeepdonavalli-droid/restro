#!/usr/bin/env python3
"""A reference for the cloud's sync endpoints (see SYNC.md), with the same rules as the main system's.

It keeps everything in memory, has one test token, and is for development and tests only, never for a restaurant's
data. The real cloud implements the same endpoints with a database, real sign-in and TLS.

    python3 tools/cloud_reference.py --port 8804 --token <a test token>

Endpoints (every request carries `Authorization: Bearer <token>`):
    POST /v1/restaurants/<id>/sync/push    { device, protocol, changes: [{ c, i, h, b, doc | x }] } -> { results }
    GET  /v1/restaurants/<id>/sync/pull?since=<seq>&limit=<n>                                  -> { seq, changes, more }
    POST /v1/restaurants/<id>/numbers/next { device, day, after }                                  -> { day, number }
    POST /v1/restaurants/<id>/numbers/next { device, day, after, series: 'bill', year }            -> { year, number }

Ticket numbers are one sequence a day for the whole restaurant, starting again at 1 every business day: each order
carries its day (YYYY-MM-DD). The cloud keeps the count (numbers/next); the main system keeps it while the restaurant's
internet is down, and every request carries the highest number the asking device knows of the day.
Bill numbers (series 'bill') are one sequence a financial year (from 1 April; year as "2026-27"), the same way: the
tax invoice's own number, kept on the order as billNo and billYear.
"""
import argparse, json, re, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

B36 = '0123456789abcdefghijklmnopqrstuvwxyz'
def to36(n):
    out = ''
    while True:
        n, r = divmod(n, 36); out = B36[r] + out
        if n == 0: return out

class Restaurant:
    """One restaurant's records: each record's latest version, in the order they changed (seq)."""
    def __init__(self):
        self.seq, self.log, self.records, self.days = 0, {}, {}, {}   # days: business day -> after the highest number seen
        self.bill_years = {}                                           # financial year -> after the highest bill number seen
        self.clock = [0, 0]
        self.lock = threading.Lock()

    # Hybrid clock, like the tablets': a version the cloud makes sorts after every version it was made from
    def observe(self, h):
        try: l, c = (int(x, 36) for x in str(h).split('.')[:2])
        except ValueError: return
        t = int(time.time() * 1000); cl, cc = self.clock; m = max(cl, l, t)
        self.clock = [m, (max(cc, c) + 1) if m == cl == l else (cc + 1) if m == cl else (c + 1) if m == l else 0]
    def tick(self):
        t = int(time.time() * 1000)
        self.clock = [t, 0] if t > self.clock[0] else [self.clock[0], self.clock[1] + 1]
        return f'{to36(self.clock[0]).rjust(9, "0")}.{to36(self.clock[1]).rjust(4, "0")}.cloud'

    def numbers_on(self, day, but=None):
        return [r['doc']['number'] for key, r in self.records.items() if key.startswith('orders/') and key != f'orders/{but}' and 'doc' in r
                and isinstance(r['doc'].get('number'), int) and (r['doc'].get('day') or '') == day]

    # The next ticket number of a day: after every number the cloud has given or seen that day (an order may have been
    # deleted since), and after `after`, the highest number the asking device knows of the day (the main system may have
    # numbered orders while the internet was down)
    def next_number(self, day, after=0):
        with self.lock:
            day = str(day or '')
            after = after if isinstance(after, int) and not isinstance(after, bool) else 0
            number = max(self.days.get(day, 1), max(self.numbers_on(day), default=0) + 1, after + 1)
            self.days[day] = number + 1
            return {'day': day, 'number': number}

    # The next bill number of a financial year ("2026-27"): after every bill number the cloud has given or seen that year
    def next_bill(self, year, after=0):
        with self.lock:
            year = str(year or '')
            after = after if isinstance(after, int) and not isinstance(after, bool) else 0
            seen = [r['doc']['billNo'] for key, r in self.records.items() if key.startswith('orders/') and 'doc' in r
                    and isinstance(r['doc'].get('billNo'), int) and r['doc'].get('billYear') == year]
            number = max(self.bill_years.get(year, 1), max(seen, default=0) + 1, after + 1)
            self.bill_years[year] = number + 1
            return {'year': year, 'number': number}

    # Ticket numbers, as on the main system, within the order's day. Numbers come from one count (numbers/next), so this
    # only settles a device's own orders from before it joined (marked provisional): a provisional number
    # stays if no other order that day has it; otherwise the order gets the day's next number. The same happens to an
    # open order whose number another order that day has.
    def settle(self, rid, doc):
        n, day = doc.get('number'), doc.get('day') or ''
        if not isinstance(n, int) or isinstance(n, bool): return None
        others = self.numbers_on(day, rid)
        taken, provisional = n in others, bool(doc.get('numberProvisional'))
        number = max(self.days.get(day, 1), max(others, default=0) + 1) if taken and (provisional or not doc.get('paidAt')) else n
        self.days[day] = max(self.days.get(day, 1), number + 1)
        if not provisional and number == n: return None
        fixed = {k: v for k, v in doc.items() if k != 'numberProvisional'}
        fixed['number'], fixed['day'] = number, day
        if number != n: fixed['numberWas'] = doc.get('numberWas') if isinstance(doc.get('numberWas'), int) else n
        return fixed

    def push(self, changes):
        results = []
        with self.lock:
            for ch in changes[:500]:
                if not isinstance(ch, dict) or not isinstance(ch.get('c'), str) or not isinstance(ch.get('i'), str) or not isinstance(ch.get('h'), str): continue
                key = f"{ch['c']}/{ch['i']}"; cur = self.records.get(key)
                self.observe(ch['h'])
                if cur and cur['h'] == ch['h']: results.append({'c': ch['c'], 'i': ch['i'], 'h': ch['h'], 'ok': True}); continue
                if cur and cur['h'] != ch.get('b'):
                    current = {'h': cur['h'], 'b': cur.get('pv')}
                    current.update({'x': 1} if 'doc' not in cur else {'doc': cur['doc']})
                    results.append({'c': ch['c'], 'i': ch['i'], 'h': ch['h'], 'conflict': True, 'current': current}); continue
                rec = {'h': ch['h'], 'pv': cur['h'] if cur else None}
                if ch.get('x'): rec['x'] = 1
                else:
                    rec['doc'] = ch['doc']
                    fixed = self.settle(ch['i'], ch['doc']) if ch['c'] == 'orders' else None
                    if fixed: rec = {'h': self.tick(), 'pv': ch['h'], 'doc': fixed}
                self.records[key] = rec
                self.seq += 1; self.log[key] = self.seq
                results.append({'c': ch['c'], 'i': ch['i'], 'h': ch['h'], 'ok': True})
        return {'results': results}

    def pull(self, since, limit):
        with self.lock:
            entries = sorted(((s, k) for k, s in self.log.items() if s > since))
            page, changes = entries[:limit], []
            for s, key in page:
                c, i = key.split('/', 1); r = self.records[key]
                ch = {'c': c, 'i': i, 'h': r['h'], 'b': r.get('pv'), 'seq': s}
                ch.update({'doc': r['doc']} if 'doc' in r else {'x': 1})
                changes.append(ch)
            more = len(entries) > len(page)
            return {'seq': page[-1][0] if more else self.seq, 'changes': changes, 'more': more}

class Cloud:
    def __init__(self, token):
        self.token, self.restaurants, self.down = token, {}, False
    def restaurant(self, rid): return self.restaurants.setdefault(rid, Restaurant())

def make_handler(cloud):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def cors(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Restro-Device, X-Restro-Protocol')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        def reply(self, status, body=None):
            data = json.dumps(body).encode() if body is not None else b''
            self.send_response(status); self.cors()
            self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers()
            self.wfile.write(data)
        def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
        def route(self, method):
            if cloud.down: return self.reply(503, {'error': 'unavailable'})
            if self.headers.get('Authorization') != f'Bearer {cloud.token}': return self.reply(401, {'error': 'sign in'})
            url = urlparse(self.path)
            m = re.fullmatch(r'/v1/restaurants/([^/]+)/(sync/push|sync/pull|numbers/next)', url.path)
            if not m: return self.reply(404, {'error': 'not found'})
            r, what = cloud.restaurant(m.group(1)), m.group(2)
            body = {}
            if method == 'POST':
                length = int(self.headers.get('Content-Length') or 0)
                try: body = json.loads(self.rfile.read(length) or b'{}')
                except ValueError: return self.reply(400, {'error': 'bad json'})
            if what == 'sync/push' and method == 'POST': return self.reply(200, r.push(body.get('changes') or []))
            if what == 'sync/pull' and method == 'GET':
                q = parse_qs(url.query)
                return self.reply(200, r.pull(int(q.get('since', ['0'])[0] or 0), max(1, min(300, int(q.get('limit', ['300'])[0] or 300)))))
            if what == 'numbers/next' and method == 'POST':
                if body.get('series') == 'bill': return self.reply(200, r.next_bill(body.get('year'), body.get('after')))
                return self.reply(200, r.next_number(body.get('day'), body.get('after')))
            return self.reply(405, {'error': 'method'})
        def do_GET(self): self.route('GET')
        def do_POST(self): self.route('POST')
    return Handler

def serve(port, token, background=False):
    cloud = Cloud(token)
    server = ThreadingHTTPServer(('127.0.0.1', port), make_handler(cloud))
    if background: threading.Thread(target=server.serve_forever, daemon=True).start()
    else: server.serve_forever()
    return cloud, server

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8804); ap.add_argument('--token', required=True)
    args = ap.parse_args()
    print(f'Reference cloud on http://127.0.0.1:{args.port} (in memory, for development only)')
    serve(args.port, args.token)
