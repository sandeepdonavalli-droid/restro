# RESTRO sync

How the restaurant's tablets share their data. Over the restaurant's own network they sync with each other, without the
internet. Once the cloud is set up, they also sync with the cloud.

The code is in `sync.js`. The screens only make two calls:
- `RestroSync.wrote(key)` after saving.
- `RestroSync.removed(collection, id)` before deleting a record on purpose.

## What syncs

| Shared by all the restaurant's tablets | Stays on each tablet |
| --- | --- |
| Orders (`restro.counter.orders.v1`) | Theme, tile style, sounds, brightness |
| Held tickets (`restro.counter.held.v1`) | Home screen and tile order |
| Customers (`restro.customers.v1`) | The order being rung up |
| Staff accounts (`restro.staff.v1`), with PINs only as salted hashes | Who is signed in |
| Restaurant name, profile, preparation time | The pairing code and the cloud sign-in |

Card data never exists in RESTRO, because payments go through the provider's hosted checkout. So it never syncs.

## Who talks to whom

```
tablet ─┐
tablet ─┼── main system ── cloud ── the owner's tablet at home
tablet ─┘   (printers)
```

Each device has exactly one server:

- A tablet paired with the main system uses the main system. They talk over the restaurant's Wi-Fi or Bluetooth,
  through the Android app.
- The main system uses the cloud, once it is set up.
- A tablet without a main system uses the cloud.

The main system is a server for its tablets and a client of the cloud. Paired tablets never talk to the cloud directly.
So each record has one line of versions per server, and a merge always starts from the right version.

**Without the internet:** the tablets keep working together through the main system.

**If the main system is off:** each tablet keeps working on its own and catches up when the main system is back.

**To replace the main system:** turn on Main system on another paired tablet. It keeps the same pairing code, so the
other tablets follow it.

## Records and versions

Every record has an id:

| Collection | Id |
| --- | --- |
| Orders | `uid` |
| Held tickets | `heldId` |
| Customers and staff | `id` |
| Settings | `restaurantName`, `profile` or `prepMinutes` |

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
- **Order lines.** Lines merge item by item:
  - Quantities add up both sides' changes: mine + theirs − what both started from.
  - An item taken off on one side, and left alone on the other, goes.
- **Kitchen tickets.** The tickets from both sides are kept. For what was sent to the kitchen, the larger count wins.
- **Payments.** A payment taken on either side stays. If both sides took one, the earlier stays.
- **Totals.** The order's totals are worked out again from its lines.
- **Deletion against an edit.** The later of the two wins.
- **No common version.** If the same record was made on two tablets before they met, the later whole record wins.

The result is a new version, made on the server's version, and it is sent again.

### Deleting

Deleting on purpose leaves a tombstone, kept for 30 days. Records a tablet only clears from itself don't travel:
- paid orders past the latest 500;
- held tickets after their day.

## Ticket numbers

**On its own:** a tablet counts from 1001, as before.

**With a server:** a tablet takes numbers in blocks of 50 from its server. It fetches the next block when fewer than
20 are left.

**The main system:**
- Numbers from its own count.
- Once the cloud is set up, it numbers from a block of 200 that the cloud gives it, topped up when fewer than 50 are
  left. That block also covers its tablets when the internet is down.

**Cut off with no numbers left:** a tablet numbers on from the highest number it knows, and marks the order
`numberProvisional`.

**Settling:** the server settles the number when it takes an order.
- A provisional number stays if no one could have it: it was never handed out (it is at least the server's next
  number) and no other order has it.
- Otherwise the order gets the next free number. The same happens to an unpaid order whose number another order has.
- The old number is kept in `numberWas`.
- The server stores the result as its own new version, made on the tablet's version.
- The tablet shows "Order #… is now #…".

**Joining:** joining (below) marks the tablet's existing orders as provisional.

**Requests for numbers:** each request carries `after`, the highest number the device knows of. The cloud never hands
out a number at or below it. This matters because the main system may have handed out numbers on its own before the
cloud was set up.

## Joining

- **The main system:** turn on Settings › Devices & sync › Main system. It makes a 6-character pairing code. The code
  uses only letters and digits that can't be confused with each other: no I, L, O, 0 or 1.
- **Other tablets:** enter the code once, in Settings › Devices & sync.
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
| `{ t: 'lease', rid, count }` | tablet → main | `{ t: 'lease', re: rid, block: { from, to } \| null }` |
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
| `POST /numbers/lease` | `{ device, count, after }` | `{ from, to }` |
| WebSocket `/sync/live` (optional) | First message: `{ t: 'auth', token, device, since }` | `{ from, seq, changes }`, as changes happen |

The rules are the server rules above, the same as the main system's. `tools/cloud_reference.py` implements them in
memory, for development and tests only.

The cloud must:
- check the token on every request, and keep each restaurant's data apart;
- store PIN hashes only in its database, never in logs: a 4-digit PIN's hash is only as safe as the database;
- keep tombstones for at least 30 days;
- never accept card data (none is ever sent).

## Security

- Nothing synced is part of the code or the website. It lives on the tablets, and later in the cloud.
- The pairing code and the cloud token stay on the device (`restro.sync.pair.v1`, `restro.cloud.v1`), never in the
  repository.
- Local messages are sealed with the pairing code's key. The Android side should also use the encrypted connections
  that Nearby Connections provides.
- A 6-character code stops casual joining. It won't stop someone who records the network traffic and spends days
  guessing. Once the cloud exists, pairing can use a random key from the restaurant's account instead.
- The cloud token never goes in an address. The WebSocket sends it in its first message.
