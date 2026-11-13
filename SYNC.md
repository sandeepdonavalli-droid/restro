# RESTRO sync

How the restaurant's tablets share their data. Over the restaurant's own network they sync with each other, without the
internet. Once the cloud is set up, they also sync with the cloud.

The code is in `sync.js`. The screens save through two calls:
- `RestroSync.wrote(key)` after saving.
- `RestroSync.removed(collection, id)` before deleting a record on purpose.

They also ask it for a new order's ticket number (`RestroSync.takeNumber()`, Ticket numbers below) and a bill's own
number (`RestroSync.takeBillNumber()`, Bill numbers below).

## What syncs

| Shared by all the restaurant's tablets | Stays on each tablet |
| --- | --- |
| Orders (`restro.counter.orders.v1`), with their bill numbers | Theme, home screen background, sounds, brightness, battery style |
| Held tickets (`restro.counter.held.v1`) | Navigation (swipe or bar) and Go dark |
| Customers (`restro.customers.v1`) | Home screen and tile order |
| Staff accounts (`restro.staff.v1`), with PINs only as salted hashes | The order being rung up |
| The restaurant's name, profile and Business details (`restro.business.v1`), with its Business hours (`restro.hours.v1`) and Bill number (`restro.billNumber.v1`; Update Pack 4) | |
| Billing & charges (`restro.billing.v1`), Staff & security (`restro.security.v1`) | Who is signed in |
| The printers' settings: role, KOT language, copies (`restro.printers.v1`) | The pairing code and the cloud sign-in |
| Kitchen prep time (`restro.kitchen.prep.v1`, and the older `restro.counter.prepMinutes.v1`) | |
| Settings › Orders, the order-ready message sent by itself: SMS, WhatsApp or off (`restro.readyMessage.v1`; Update Pack 4) | |
| What is sold out (`restro.menu.availability.v1`) | |
| The Orders display and the Counter's look (`restro.ordersLook.shared.v1`, `restro.counterLook.shared.v1`): branch-wide since Update Pack 4, so one for every tablet. A tablet's own value from before (`restro.ordersLook.v1`, `restro.counterLook.v1`, Use on · This tablet only) becomes the restaurant's once, when it is newer, and is then removed | |

Card data never exists in RESTRO, because payments go through the provider's hosted checkout. So it never syncs.

## Who talks to whom

```
tablet ─┐
tablet ─┼── main system ── cloud
tablet ─┘   (printers)
```

Each device has one server at a time:

- A tablet paired with the main system uses the main system. They talk over the restaurant's Wi-Fi or Bluetooth,
  through the Android app.
- The main system uses the cloud, once it is set up.
- A tablet without a main system uses the cloud.

The main system is a server for its tablets and a client of the cloud. A merge always starts from the version the
change was made on, so a tablet can change servers safely.

**Without the internet:** the tablets keep working together through the main system, and it prints for the kitchen.

**If the main system is off:** a paired tablet signed in to the cloud carries on with the cloud on its own, once the
main system has been gone for 5 seconds. It goes back to the main system when it is on again. The kitchen printer is
wired to the main system, so it can't print until then.

**To replace the main system:** turn on Main system on another paired tablet. It keeps the same pairing code, so the
other tablets follow it.

## Records and versions

Every record has an id:

| Collection | Id |
| --- | --- |
| Orders | `uid` |
| Held tickets | `heldId` |
| Customers and staff | `id` |
| Settings | `restaurantName`, `profile`, `business`, `billing`, `security`, `printers`, `prepMinutes`, `kitchenPrep`, `availability`, `ordersLook` or `counterLook` |

Every record also has a version `h`, a hybrid-clock stamp `ttttttttt.cccc.<device id>`:
- the first part is the time in milliseconds, in base 36;
- the second part is a counter, in base 36.

Versions sort as plain strings. A device always makes a version later than every version it has seen, so a change
sorts after what it changed.

A change travels as:

```
{ c: collection, i: record id, h: version, b: the version it replaces (or null), doc: the record }
```

A deletion has `x: 1` in place of `doc`.

## Server rules (the main system and the cloud)

Each server keeps, for every record, its latest version and that version's parent. It also keeps a sequence number
`seq`, which goes up by one for every change it takes.

### Push

The server checks each change:

| Case | Answer |
| --- | --- |
| Same `h` as the server's version | `{ ok: true }`. Sending a change twice changes nothing. |
| The server has the record, and its version isn't `b` | `{ conflict: true, current: { h, b, doc \| x } }` |
| Anything else | The server takes the change (`seq + 1`), answers `{ ok: true }` and passes the change on to everyone. |

### Pull

A pull since a given `seq` returns the latest version of every record changed after it, in `seq` order, in pages:

```
{ seq, changes: [{ c, i, h, b, doc | x, seq }], more }
```

If a client's cursor is past the server's `seq`, the client starts again from 0.

### Orders

Ticket numbers are settled by the server too, as described under Ticket numbers below.

### QR payments (Update Pack 5, H1)

A QR order whose payment hasn't been confirmed carries `qrPay` (ANDROID-BRIDGE.md, QR payment Pending): `'waiting'`
(the customer is on the payment page), `'pending'` (marked by a tablet after 30 s with no confirmation and no cloud),
`'matching'` (staff answered Customer paid: `paidAt` set, its KOT sent) or `'refund'` (staff answered Cancel and
refund); with `qrPayAt` (when the customer paid) and `qrChoice: { choice, by, at }`. Once the cloud can reach the
payment provider again it settles each one, and its change goes to the tablets as any other:

| Answered | The money | The cloud |
| --- | --- | --- |
| Customer paid (`'matching'`) | arrived | takes off `qrPay`; sets `method` (`'upi'`, `'card'`, `'netbanking'`, `'wallet'`), `paidAt` (the payment's time) and `payRef` |
| not yet (`'waiting'`, `'pending'`) | arrived | the same; the main system then prints its KOT by itself |
| Cancel and refund (`'refund'`) | arrived | refunds it; sets `paidAt`, `method`, `refundedAt`, `refundMethod`; takes off `qrPay` |
| not yet, or Cancel and refund | never | deletes the order (a tombstone, as any deletion) |
| Customer paid | never | tells the owner (what the order shows then is for the owner to decide) |

A payment made twice is refunded by itself. Every answer and settlement is kept for Analytics › Activity › Payments and
the Payments app, with who did it (`qrChoice`, the Track history's `qr-paid` / `qr-refund`).

## On each tablet

### Saving

Every record that changed gets a new version and waits to be sent. The tablet remembers two things with it:
- the server version the change was made on;
- that version's record.

### Receiving a version

| What arrives | What the tablet does |
| --- | --- |
| The version it already has | Nothing more. If that version was waiting, the server now has it. |
| A version older than the one it has | Ignores it. |
| A version made on the one it has | Takes it. The new version already contains this tablet's change. |
| Any other version, with no change waiting here | Takes it. |
| Any other version, with a change waiting here | Merges the two. |

### Merging

A merge starts from the version both sides started from:

- **Fields.** A field changed on one side takes that side. A field changed on both takes the later version's.
- **Order lines.** Lines merge item by item (the same item with other choices, such as Extra spicy, is a line of its own):
  - Quantities add up both sides' changes: mine + theirs − what both started from.
  - An item taken off on one side, and left alone on the other, goes.
- **Kitchen tickets.** The tickets from both sides are kept. For what was sent to the kitchen, the larger count wins.
- **Track history** (`events`: discounts, moves, priority and the like, Update Pack 3). Kept from both sides, by id.
- **Payments.** A payment taken on either side stays. If both sides took one, the earlier stays.
- **A QR payment's answer** (Update Pack 5, H1: Customer paid? answered on two tablets at the same moment, `qrChoice`).
  The earlier answer stays, with what it set (`qrPay`, `paidAt`), over the payment rule above (K: "the first wins").
- **Totals.** The order's totals are worked out again from its lines.
- **Deletion against an edit.** The later of the two wins.
- **No common version.** If the same record was made on two tablets before they met, the later whole record wins.

The result is a new version, made on the server's version, and it is sent again.

### Deleting

Deleting on purpose leaves a tombstone, kept for 30 days. Records a tablet only clears from itself don't travel:
- orders older than the 4 business days a device keeps (below);
- held tickets after their day.

### The orders a device keeps (Update Pack 5)

Each device keeps 4 business days of orders: today and the 3 days before, by the day an order was taken (`day`) or the
day it was taken for (`readyAt`). It also keeps every order not paid yet, whatever its day, and every order with a
change still to send to its server, so nothing waiting to go is ever cleared (`keepOrders` in `sync.js`; the Counter
saves its list through `RestroSync.keepOrders`). Older orders are cleared from that device only; the cloud keeps them.
Orders reads them from the cloud when its Today list scrolls back past the kept days, or when a day from before them is
picked (`RestroSync.olderOrders({ from, to })`, below), and keeps them in memory only. Printing a receipt for one
brings that order back onto the device with the print noted, until it has gone up.

## Ticket numbers

**One sequence a day for the whole restaurant, kept in one place.** The cloud keeps the count. While the restaurant's
internet is down, the main system keeps it. If the last order is #10, the next order, from any device, is #11. Two
orders never share a number, and a number never changes.

**Every business day starts again at #01.** A business day ends when the restaurant closes, and the next one starts the
minute after (Settings › Business details › Business hours, `restro.hours.v1`; Update Pack 4): open till 2 AM, 2:00 AM
is the day's last minute and 2:01 AM the new day, so a late night after midnight stays on the same day; open till
11 PM, 11:01 PM is the next day already. A day the restaurant is closed ends at midnight. Each order keeps the day it was numbered on (`day`, as `YYYY-MM-DD`). Numbers show as #01, #02 … #10.
They repeat from day to day, so an order is always found by its `uid`, never by its number.

**Firing an order:** a tablet asks for the next number when it fires a new order, and saves the order with it:
- **Through the main system,** over the restaurant's Wi-Fi or Bluetooth. The main system asks the cloud (2 seconds at
  most), or numbers from its own count while the internet is down. It numbers its own orders the same way.
- **Straight from the cloud,** while the main system can't be reached (say it is off), or doesn't answer in 3 seconds.
  This needs the tablet to be signed in to the cloud.
- **Neither:** the tablet can't fire an order, or save or take payment on one. It says so, and the order stays on its
  screen until it can.
- **On its own:** a tablet counts by itself.

Every request carries `after`, the highest number the asking device knows of the day, and the answer is always past
it. So when the internet comes back, the cloud carries on after the numbers the main system gave without it. Each
device also remembers the highest number it has given or seen today, so a deleted order's number isn't given again.

The one case that can still clash: a tablet out of the main system's range, on its own mobile data, fires while the
restaurant's internet is down. The cloud then gives the number while the main system also gives numbers. When the two
meet, the cloud gives the later open order the next number, and the tablet shows "Order #11 is now #12".

**A tablet's orders from before it joined:** joining (below) marks them `numberProvisional`. The server settles them
when it takes them, within the order's day:
- A provisional number stays if no other order that day has it. The server stores the order without
  `numberProvisional`, as its own new version made on the tablet's version.
- Otherwise the order gets the day's next number, and the old number is kept in `numberWas`. The tablet shows
  "Order #03 is now #12".
- The same happens to an open order whose number another order that day has. In normal use this can't happen.

## Bill numbers

**A bill's own number, apart from the order's** (Update Pack 3): the tax invoice's serial, printed "Bill #B-2045 ·
Order #1015". One sequence for the whole restaurant, every number given once, starting again at B-1 each financial
year (1 April). It is kept like the ticket numbers: by the cloud, and by the main system while the restaurant's internet
is down; a tablet on its own counts by itself. An order is given its bill number the first time its bill (or receipt)
prints, or when it is paid, whichever comes first, and keeps it: `billNo` (2045) and `billYear` (`"2026-27"`). A paired
tablet that can reach neither the main system nor the cloud can't print the bill, or take the payment, until it can.
With Settings › Business details › Bill number set to **At payment** (Update Pack 4, `restro.billNumber.v1`), a bill
printed before the payment has no number ("BILL · NOT A TAX INVOICE"); the order gets its number when it is paid.

## KOT numbers

**One sequence a business day for the whole restaurant** (Update Pack 4, A2), from 1, starting again with the ticket
numbers when the business day ends. A KOT gets its number **when it prints** (`RestroSync.takeKotNumber()`, `{ day,
number }`): a queued scheduled KOT has none until then. It is kept like the ticket numbers: by the cloud, and by the main
system while the internet is down. Unlike a ticket number, a KOT is never held back: a paired tablet that reaches
neither the main system nor the cloud numbers it from its own count, past every KOT it has given or seen that day, so
the kitchen always gets it. The number is kept on the KOT (`no`, in the order's `kots`) and syncs with the order.

## Joining

- **The main system:** turn on Settings › Devices › Main system. It makes a 6-character pairing code. The code
  uses only letters and digits that can't be confused with each other: no I, L, O, 0 or 1.
- **Other tablets:** enter the code once, in Settings › Devices.
- **The cloud:** after the restaurant signs in, call `RestroSync.configureCloud({ endpoint, restaurantId, token })`.
  The sign-in screen comes with the cloud.

The first time a device gets a server:
- It offers the server everything it has, once, made on its own versions. Where the server already has another
  version of a record (the restaurant's name, say), the server's version stays.
- Its orders are marked provisional, so the server settles their numbers.
- If it receives staff accounts while nobody is signed in, it asks for a PIN.

## Local messages (through `RESTRODevice.localSync`)

**Sealing.** Every message is sealed as `{ v: 1, iv, data }`, using AES-256-GCM. The key comes from the pairing code:
- PBKDF2-SHA256, 100,000 rounds, salt `restro-local-sync-v1`;
- the key is the first 32 bytes.

**Finding each other.** The tablets find each other by the service name `restro-<12 hex digits>`. The hex digits are
the next 6 bytes of the same derivation, so the service name doesn't give the code away.

**Checking the sender.** Inside the sealed message, `sender` must equal the device id the bridge reports. Otherwise the
message is dropped.

| Message | From → to | Answer |
| --- | --- | --- |
| `{ t: 'pull', rid, since }` | tablet → main | `{ t: 'batch', re: rid, server, seq, changes, more }` |
| `{ t: 'push', rid, changes }` (up to 200 records, about 200 kB) | tablet → main | `{ t: 'ack', re: rid, results }` |
| `{ t: 'number', rid, after }` (firing a new order; answered within 3 seconds or asked of the cloud) | tablet → main | `{ t: 'number', re: rid, day, number }` |
| `{ t: 'number', rid, after, series: 'bill' }` (a bill number; `after`: the highest of the year this tablet knows) | tablet → main | `{ t: 'number', re: rid, year, number }` |
| `{ t: 'number', rid, after, series: 'kot' }` (a KOT number as it prints; `after`: the highest of the day this tablet knows) | tablet → main | `{ t: 'number', re: rid, day, number }` |
| `{ t: 'batch', server, from, seq, changes }` | main → all | None. A tablet whose cursor is behind `from − 1` pulls. |

A tablet pushes and pulls:
- when it finds the main system;
- 250 ms after every change;
- every 15 seconds.

## Cloud API (to build)

The base address is `<endpoint>/v1/restaurants/<restaurantId>`. Bodies are JSON.

Every request carries these headers:
- `Authorization: Bearer <token>`, a token for each device, from the restaurant's sign-in;
- `X-Restro-Device`;
- `X-Restro-Protocol: 1`.

| Method and path | Body | Answer |
| --- | --- | --- |
| `POST /sync/push` | `{ device, protocol, changes }` | `{ results: [{ c, i, h, ok } \| { c, i, h, conflict, current }] }` |
| `GET /sync/pull?since=<seq>&limit=300` | none | `{ seq, changes, more }` |
| `POST /numbers/next` (firing a new order) | `{ device, day, after }` | `{ day, number }`, past `after` and every number of the day |
| `POST /numbers/next` (a bill number) | `{ device, day, after, series: 'bill', year }` | `{ year, number }`, past `after` and every bill number of the financial year |
| `POST /numbers/next` (a KOT number) | `{ device, day, after, series: 'kot' }` | `{ day, number }`, past `after` and every KOT number of the day |
| WebSocket `/sync/live` (optional) | First message: `{ t: 'auth', token, device, since }` | `{ from, seq, changes }`, as changes happen |
| `GET /orders?from=<day>&to=<day>` (Update Pack 5) | none | `{ orders, more }`: every order whose `day` is from `from` to `to` (business days, `YYYY-MM-DD`), newest first, each its latest version; `more` when there are older orders. Read only |

The rules are the server rules above, the same as the main system's. `tools/cloud_reference.py` implements them in
memory, for development and tests only.

The cloud must:
- check the token on every request, and keep each restaurant's data apart;
- store PIN hashes only in its database, never in logs: a 4-digit PIN's hash is only as safe as the database;
- keep tombstones for at least 30 days;
- never accept card data (none is ever sent);
- give ticket numbers and bill numbers one at a time, so two requests never get the same number.

## Security

- Nothing synced is part of the code or the website. It lives on the tablets, and later in the cloud.
- The pairing code and the cloud token stay on the device (`restro.sync.pair.v1`, `restro.cloud.v1`), never in the
  repository.
- Local messages are sealed with the pairing code's key. The Android side should also use the encrypted connections
  that Nearby Connections provides.
- A 6-character code stops casual joining. It won't stop someone who records the network traffic and spends days
  guessing. Once the cloud exists, pairing can use a random key from the restaurant's account instead.
- The cloud token never goes in an address. The WebSocket sends it in its first message.
