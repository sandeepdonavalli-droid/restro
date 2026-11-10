# RESTRO Android bridge

Browsers cannot list or join Wi-Fi networks, and they show Bluetooth devices only in
their own picker. The RESTRO Android app fills that gap by defining these optional
objects on `window.RESTRODevice` before the page loads. The web screens detect them
automatically; nothing else needs to change.

## Wi-Fi: `RESTRODevice.wifi`

| Method | Returns | Android API |
| --- | --- | --- |
| `isEnabled()` | `true` / `false` | `WifiManager.isWifiEnabled()` |
| `setEnabled(on)` | — | Drives the Wi-Fi switches in Settings. `WifiManager.setWifiEnabled` works for system/device-owner apps; otherwise open `Settings.Panel.ACTION_WIFI` |
| `scan()` | `[{ ssid, level, secure, connected, saved }]` | `WifiManager.startScan()` + `getScanResults()`; `level` = `calculateSignalLevel(rssi, 5)` (0–4) |
| `connect(ssid, password?)` | `true` / `false` | `WifiNetworkSuggestion` or `WifiNetworkSpecifier` (Android 10+) |
| `disconnect()` | — | `ConnectivityManager.unregisterNetworkCallback` / remove suggestion |

Status bar: keep sending connectivity through the existing
`RESTRODevice.subscribeConnectivityStatus(callback)` with
`{ wifi: { connected, level }, internetAvailable }`. `level` (0–4) drives the bars.

Permissions: `ACCESS_FINE_LOCATION` (or `NEARBY_WIFI_DEVICES` on Android 13+),
`ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`.

## Bluetooth: `RESTRODevice.bluetooth`

| Method | Returns | Android API |
| --- | --- | --- |
| `isEnabled()` | `true` / `false` | `BluetoothAdapter.isEnabled()` |
| `setEnabled(on)` | — | Drives the Bluetooth switches. `BluetoothAdapter.enable()/disable()` for system/device-owner apps; otherwise `ACTION_REQUEST_ENABLE` |
| `startScan(onDevice)` | a `stop()` function | `BluetoothLeScanner.startScan` and/or `BluetoothAdapter.startDiscovery()`; call `onDevice({ id, name, rssi })` per device |
| `connect(id)` | `true` / `false` | `BluetoothDevice.createBond()` / `connectGatt()` / RFCOMM for printers |
| `disconnect(id)` | — | `BluetoothGatt.disconnect()` / close socket |
| `getPairedDevices()` | `[{ id, name, connected }]` | `BluetoothAdapter.getBondedDevices()` |

Permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (Android 12+), `ACCESS_FINE_LOCATION` (older).

All methods may return promises. Throw an `Error` with a short message to show it to the user.

## Sound: `RESTRODevice.setVolume(level)`

Optional. `level` is 0–100 from the Volume sliders (Settings › Sound and quick controls).
Map it to `AudioManager.setStreamVolume(STREAM_MUSIC, level * max / 100, 0)`.

## Sync between tablets: `RESTRODevice.localSync`

Lets the restaurant's tablets sync over its own Wi-Fi or Bluetooth, with or without the internet (see SYNC.md). The page
seals every message itself; the app only finds the other tablets and carries text between them.

| Method | Returns | What the app does |
| --- | --- | --- |
| `start(info, onMessage, onPeers)` | a `stop()` function | Nearby Connections with `Strategy.P2P_STAR` and `info.service` as the service id: the main system (`info.main`) advertises and accepts, the other tablets discover and connect to it. Put `{ deviceId, name, main }` in the endpoint info so each side knows the other's device id. Calling `start` again replaces the previous session (the device name or role changed) |
| `send(text, toDeviceId)` | — (may be a promise) | Sends `text` to one tablet, or to every connected tablet when `toDeviceId` is `null`. Messages can reach about 300 kB: use `Payload.Type.STREAM`, or split into 32 kB byte payloads and join them before `onMessage` |

`info` is `{ deviceId, name, main, service, protocol }`.

- `onMessage(fromDeviceId, text)`: call it for every whole message received, with the sender's device id.
- `onPeers([{ id, name, main }])`: call it with the connected tablets whenever that list changes (`[]` for none).

Accept connections automatically: the page drops anything not sealed with the restaurant's key. Keep the session
running while the app is open (a foreground service) and reconnect after network changes. A LAN version (NSD discovery
and a WebSocket) can sit behind the same two methods.

Permissions: `NEARBY_WIFI_DEVICES` (Android 13+); `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`
(Android 12+); `ACCESS_FINE_LOCATION` (older); `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`.

## Texting customers and buzzing pagers: `RESTRODevice.sms` and `RESTRODevice.pager`

Optional. Orders has two round buttons on every order: one texts the customer (when the order has their phone number),
the other buzzes the order's pager (when it has one), whatever the payment status. Without these, the buttons say that
texting or pagers start with the Android app.

| Method | Returns | What the app does |
| --- | --- | --- |
| `sms.send({ to, code, text, order })` | `true` / `false` (may be a promise) | Sends `text` to `+code to`, for example "Your order #12 is ready. – AKSHAYAPATRA". `SmsManager` on the tablet (`SEND_SMS`), or an SMS service once the cloud exists. `order` is the order's id, for a log |
| `pager.buzz(number)` | `true` / `false` (may be a promise) | Buzzes pager `number` through the restaurant's paging transmitter (USB, Bluetooth or the network, depending on the pager system) |

**When the kitchen marks an order complete** (with the kitchen screen, to build), both go out on their own: the text
if the order has a phone number, the buzz if it has a pager. With neither, nothing happens. The main system sends them
(or the tablet that fired the order, without a main system), so each goes out once however many tablets there are. The
two buttons stay, to send again by hand: Text whenever the order has the customer's phone number, whatever its status,
until 1 hour 15 minutes after the order is done on every side (Closed, and its pager docked back when it had one);
Buzz until the pager is docked back (below), then greyed out with the pager's number kept on it, for the record. The
kitchen screen also marks the order `kitchenDoneAt` (the time) when the whole order is complete, cleared when more
items go to the kitchen. Orders shows Open with In kitchen under it once the order goes to the kitchen, then Ready,
and Closed once the order is also paid and, when it had a pager, the pager is docked back (owner, 10 Nov 2026; at once
when it was paid upfront and had no pager). Every restaurant has the kitchen screen for now; subscription levels will
decide it later, and without it orders are just Open, then Closed when paid (and the pager docked).

**When a pager is docked back** in its docking station (connected to the main system), dispatch on the main system:

```js
window.dispatchEvent(new CustomEvent('restro:pager-docked', { detail: { number: 12 } }));
```

Only then is the pager released from its orders: every order that has it is marked `pagerBackAt`, its Buzz button goes
grey with the number kept on it, and the pager shows as free in Counter's Assign Pager. The mark syncs to the other
tablets. Opened again in Counter, the order shows no pager: whatever pager is on it when it is saved again is its
pager, the same one handed back or another (then out with the customer, `pagerAt`), or none (then it keeps the old
number, still back, for the record). A pager still out with another order, picked in Assign Pager or tapped on the NFC
spot, asks first (Update Pack 3): **Same customer** (they kept it for this order too: both orders have it,
`pagerShared` on the newer one, and docking it releases both) or **Handed back** (it moves to this order and is marked
back from the other). A held order's pager is released when it is held.

**When a pager is tapped on the tablet's NFC spot** (Update Pack 3), dispatch on that tablet:

```js
window.dispatchEvent(new CustomEvent('restro:pager-tapped', { detail: { number: 12 } }));
```

With Counter open, the pager goes on the order on screen at once, with Undo (or the question above, when another order
still has it). Anywhere else it opens that pager's order: in Counter while it isn't paid, in Orders once it is; "Pager
12 isn't out" when no order has it.

## Orders (Update Pack 3): WhatsApp, the paper roll, delivery apps

| Method or event | |
| --- | --- |
| `RESTRODevice.whatsapp.send({ to, code, text, order })` | Optional, like `sms.send`: Notify's WhatsApp. Return `true` / `false` (may be a promise); `false` falls back to SMS |
| `RESTRODevice.printer.newRoll()` | Staff confirmed a new paper roll in the bill printer: reset its paper level to 100% (and tell the other tablets through `restro:printer-paper`) |
| `restro:printer-cover`, `{ printer, level }` | Dispatch when the bill printer's cover was opened and closed: Orders asks "New paper roll?" (`printer`: its name; `level`: the level before) |
| `RESTRODevice.integrations.markReady({ platform, id, order })` | A delivery app's order marked ready in Orders (Ready → Marked): tell the platform (`"swiggy"`, `"zomato"`; `id` its order number), once the integrations exist |

## Screen lock: `restro:device-locked` and `restro:device-unlocked`

Dispatch these as window events when the tablet's power button locks the screen (`ACTION_SCREEN_OFF`) and when it is
unlocked (`ACTION_USER_PRESENT`). With staff accounts set up, locking signs the person out and the lock screen asks for
a PIN.

## The keyboard: `restro:keyboard`

The lock button stays while staff type, so a tablet left with its keyboard up can still be locked. Android draws its
keyboard over the app, so while the keyboard is up the page lifts the lock to sit just above it (in the navigation bar
mode, the whole bar). In a browser the page sees the keyboard itself. When the RESTRO Android app keeps the page full
height under its keyboard (full-screen kiosk mode does), tell the page how much the keyboard covers whenever that
changes:

```js
window.dispatchEvent(new CustomEvent('restro:keyboard', { detail: { height: 386 } })); // CSS pixels; 0 when it goes down
```

Take it from `WindowInsetsCompat.Type.ime()` (its bottom inset, in CSS pixels: device pixels ÷ the WebView's density).

## Printing the bill: `RESTRODevice.printer.printBill(bill)`

Counter's **Print bill** button (the printer, at the end of the order panel's top row) prints the bill. With this
method present, the bill goes to it, to print on the restaurant's bill printer; without it, the browser's own printing
opens. Return `false` (or throw) if it didn't print; Counter says so.

Print it as `25_printed-bill` (Counter Update 7, the customer's copy, the same for every kind of order), 80 mm,
**black only**:

- **Header:** `restaurant` (large), `address`, then the restaurant's phone · email (`phone`, printed `+91 98765
  43210`, and `email`, Settings › Business details; Update Pack 3), then `GSTIN …` · `FSSAI …` (`gstin`, `fssai`: the
  FSSAI licence number is required on bills in India). A dashed rule, **TAX INVOICE**, then `Bill #B-2045 · Order
  #1015` (`bill`: the bill's own number, one series for the restaurant starting again at B-1 each financial year,
  given at the first print or at the payment, `null` before; `number`: the order's ticket, e.g. `"#05"`, or `null` for
  an order not saved yet) and the date and time (`at`, milliseconds, printed `7 Nov 2026 11:58 AM`), then `type` ·
  `Table …` (`table`) · `… guests` (`guests`, 0 for none), and `Server: EC` (the initials of `server`).
- **Dishes:** each of `lines`, `{ name, qty, each, total, modifiers, discount }`: `2 × Sweet lassi` and its `total`;
  its `modifiers` under it on one line (`"Half · Medium spicy"`); its dish discount, when it has one, as an indented
  minus line: `discount.label` and −`discount.amount` (`"10% off"` −26.00, `"100% off · Complaint"` −180.00). Dish
  notes are for the kitchen and are not on the customer's bill. A custom item is a line like any other.
- **Sums, in this order:** Subtotal (`subtotal`: after the dish discounts); the order discount (`discount`:
  `{ label, percent, amount }`, `"Discount 10%"`, printed as −84.40); the service charge (`serviceCharge`:
  `{ label, percent, amount }`, `"Service charge 5% (optional)"`); `packaging` and `delivery` (`{ label, amount }`);
  each of `taxes` on its own line (`"CGST 2.5%"` and `"SGST 2.5%"`, with their amounts); `roundOff` when it isn't 0
  (`"Round off −0.46"`); then **GRAND TOTAL** `total` (to the rupee). Each of these is `null` when the order hasn't
  got it. (`tax` and `taxLabel` are the two taxes together, `"GST 5%"`.)
- **Footer:** each of `footer` on its own line, centred: the service-charge line when there is a service charge
  (`"Service charge is optional — ask us to remove it."`), then the bill footer
  (`"Thank you! Visit again."`, Settings › Business details).

Amounts are in rupees.

**Reprints and receipts** (Update Pack 3, `PS01_bill-and-receipt-reprint`; black only):

| Field | |
| --- | --- |
| `kind` | `"bill"` (not paid yet) or `"receipt"` (paid: a document of its own, not a reprint of the bill) |
| `title` | `"TAX INVOICE"` or `"TAX INVOICE · RECEIPT"`, printed where TAX INVOICE is |
| `at` | the bill's first print (a receipt keeps the bill's date and time when a bill was printed first, otherwise its own first print); a reprint keeps it |
| `reprint` | `null` on a first print; on every later print of the same bill or receipt `{ at, by }`: a bold black outlined box at the very top, **REPRINT** in large letters, and under it `"Reprinted 7 Nov 2026 12:20 PM · by RK"` (`by`: the staff's initials) |
| `paid` | receipts only: `{ method, amount, at, ref }`, a boxed line above the footer, `"PAID · UPI ₹837"` and under it `"7 Nov 2026 12:41 PM · Ref 4318 9920 1187"` (`ref` only when the payment has one) |

Each print is kept on the order (`bills`, `receipts`: `{ at, by, total }`), so the next one is a REPRINT on every tablet.

## The kitchen printer: `RESTRODevice.printer.printKot(slip)`

Counter Update 7. **Save sends the KOT, and so does Pay**; each KOT has only the dishes the kitchen doesn't have yet
(a later KOT has only what was added after the earlier ones). KOT numbers run through the business day for the whole
restaurant: the day's first KOT is #1, starting again at 4 AM with the order numbers. After a KOT has gone, taking a
dish off or reducing it prints a **VOID** slip, deleting the order prints **ORDER CANCELLED** (both with the reason
staff gave), changing a dish's choices or note prints a **CHANGED** slip, and marking the order as priority prints a
short **★ PRIORITY** notice. **Reprint KOT** (the order menu) sends the last KOT again, as it was. A scheduled order's
KOT goes at its kitchen time, from the tablet that saved it last.

Print each slip on every printer whose role is **Kitchen** or **Both**. Return `true` (or a Promise of it) when it
printed, `false` (or throw, or reject) when it didn't: Counter then shows "Kitchen printer offline / KOT #3 not sent"
with **Retry**, and calls `printKot` again with the same slip. Without this method (a browser) the slips are kept on
the order only.

Update Pack 3: say why it didn't print with `{ ok: false, reason }` (or reject with an error carrying `reason`):
`"paper"` (out of paper), `"offline"` (the printer doesn't answer) or `"cover"` (its cover is open). A KOT that didn't
print is kept as failed on its order (`failed`, `failWhy`): Orders shows **KOT !** with the reason, and the tablet
that sent it tries again by itself every 30 seconds until it prints.

`slip` is plain data:

| Field | |
| --- | --- |
| `kind` | `"kot"`, `"void"`, `"changed"`, `"cancel"`, `"priority"` or `"cancel-bulk"` (below) |
| `band` | the black band at the top: `"DINE-IN"`, `"TAKEAWAY"`, `"DELIVERY"`, `"PHONE ORDER"` (`type` is the order type) |
| `action` | the red outlined box under it, or `null` for a plain KOT: `"★ PRIORITY"`, `"VOID"`, `"CHANGED"`, `"ORDER CANCELLED"` |
| `title`, `where` | bold: `"KOT #3 · Order #1015"`, then `"Table 12"` / `"Pager 18"` / `"Pickup 1:15 PM"` (`kot` is the KOT's number, `order` the ticket) |
| `info` | small: `"4 guests · 11:46 AM · Server: EC"`; for takeaway and phone orders the customer and a masked phone; on a void `"11:52 AM · By: EC"`; on ORDER CANCELLED `"VOID ALL · KOT #141, #152 · 12:05 PM · By: EC"` |
| `note` | the order note, in a red box (`"ORDER NOTE: …"`), on every KOT; `""` for none |
| `lines` | `{ qty, name, names, mods, note }`: `qty × name` bold (minus quantities on VOID and ORDER CANCELLED: `−8 ×`), quantities right-aligned in a fixed column; then every one of `mods` on its own line, right-aligned, red (on a CHANGED slip these are the changes: `"Medium spicy → Less spicy"`, `"+ No onion"`, `"+ Note: …"`); the dish's `note` last, red italic, right-aligned (`"Note: …"`). `names` is the dish's names in other languages, set on the dish in Inventory (`{ te: "…" }`), or `null` |
| `footer` | small, at the end: `"KOT #141, #152 sent earlier · only new dishes on this KOT"`, or `"Reason: Customer changed mind"` |
| `priority` | true when the ★ PRIORITY box is on it |
| `printers` | Settings › Devices › Printers: `[{ id, language, copies }]` for the kitchen printers |
| `reprint` | KOTs reprinted from Orders (Update Pack 3): `{ at, by }`, the red **REPRINT** box with the time and initials, and **(R)** after every dish (Update Pack 1); `undefined` otherwise |

- **Red** (modifiers, dish notes, the order note, the action box) prints red on two-colour printers (red/black ribbon or
  two-colour thermal paper) and black on black-only printers.
- **Language:** each printer's KOT language (`"English"`, `"Telugu"`, `"Hindi"`, `"Tamil"`, `"Kannada"`,
  `"Malayalam"`, `"Marathi"`, `"Bengali"`, `"Gujarati"`). Anything but English is printed as an image (raster), as
  thermal printers have no Indic fonts; a dish's name in that language comes from `names` (keyed by the language's code:
  `te`, `hi`, `ta`, `kn`, `ml`, `mr`, `bn`, `gu`), falling back to English.
- **Copies:** `copies` (1–3) of each slip on that printer.

The page keeps every slip on its order (`kots`: `{ id, at, kind, no, lines, reason, by }`), with who did it and why
(no manager PIN for now).

**Bulk cancel** (Update Pack 3, `PS02_bulk-cancel-slip`): orders deleted together in Orders print one compact slip
instead of one ORDER CANCELLED each: `kind: "cancel-bulk"`, `band` (`"ORDERS CANCELLED"`, the black band), `action`
(`"BULK DELETE · 5 ORDERS"`, the red outlined box), `at` (printed `Mon 9 Nov 2026 · 11:58 PM`), `info` (`"By: EC ·
Reason: End of day – not collected"`), `orders` (`{ order, kots, at }` each, newest first, as a table ORDER · KOT ·
TIME: `"#1031"`, `"141 · 152"` or `"—"` for an order that never reached the kitchen, `7:24 pm`), `footer` (`"— = order
never reached the kitchen."`) and `printers`. A single order deleted prints its ORDER CANCELLED slip as before.

## The printers: `RESTRODevice.printer.list()`

Settings › Devices › Printers lists the printers the app knows (the main system's): return `[{ id, name, connection }]`
(or a Promise of it), `connection` e.g. `"Bluetooth"`, `"Wi-Fi"`, `"USB"`. Each printer's role (Bills, Kitchen or Both),
KOT language and copies are set there and kept in `restro.printers.v1` (`{ <id>: { role, language, copies } }`), which
the page passes with each slip.

## Messages: `RESTRODevice.recommendedTimeout(ms, hasControls)`

Counter's messages go after 2 s (a confirmation) or 4 s (one with Undo); errors stay. Return Android's
`AccessibilityManager.getRecommendedTimeoutMillis(ms, flags)` (with `FLAG_CONTENT_TEXT`, plus `FLAG_CONTENT_CONTROLS`
when `hasControls` is true), so the "Time to take action" accessibility setting is respected. Without it the times are
as above.

## The bill printer's paper: `RESTRODevice.printer.paperStatus()` and `subscribePaperStatus(callback)`

The Print bill button shows how much paper the bill printer has left: its light blue drains from the top as the roll is
used; at 20% or less (or when the printer's near-end sensor says so) the whole button turns amber; out of paper (or the
cover open) it turns red with a "!"; with the printer offline it is grey, crossed out. A tap still prints.

Report it for the printer whose role is **Bills & receipts** or **Both** (Settings → Printers); a kitchen-only printer
is never shown. Each status is plain data, `{ level, state }`: `level` the paper left, 0–100 (%); `state` one of
`"ok"`, `"low"`, `"out"`, `"offline"`.

| Member | Returns | Notes |
| --- | --- | --- |
| `paperStatus()` | `{ level, state }` (or a Promise of it) | Read when Counter opens and after each bill |
| `subscribePaperStatus(callback)` | a function that stops it | Call `callback({ level, state })` on every change |

Or dispatch a `restro:printer-paper` window event with the same `detail`. Without any of these the button shows a full
roll.

Work the level out as `PaperEstimator` does (Counter Update 5, `CounterUpdate5.kt`):

- The roll's size is set in the printer's settings (e.g. 80 mm × 50 m). After every print, take off what was printed
  (its lines × the line height, plus the feed and the cut). A **Both** printer counts bills and kitchen tickets.
- Poll the printer's status (ESC/POS `DLE EOT`) every 10 seconds and after every job: near-end means `"low"`, paper-end
  or the cover open `"out"`, no answer `"offline"`.
- Start again at 100% when paper-end was reported and the cover was then opened and closed, or when staff tap **New roll
  fitted** in the printer's settings.

## Back, Home and Recent apps: `RestroSystem.back()`, `.home()`, `.recents()`

RESTRO runs end to end on the 1920 × 1080 panel as the tablet's home app in lock-task (kiosk) mode: hide Android's own
status bar and navigation bar. RESTRO draws its own navigation (Settings › Display › Navigation): **swipe** (the
default: a black pill at the bottom centre; swipe up from the bottom edge for Home, swipe up and hold for Recent apps,
swipe in from the left or right edge for Back) or a **navigation bar** (56 px, black: Back, Home and Recent apps, Back on
the left or the right), with a lock button in both. When Android's gesture navigation still reaches the app first,
forward it: the back gesture (`OnBackPressedCallback`) to `RestroSystem.back()`, Home (`onNewIntent` with
`CATEGORY_HOME`) to `RestroSystem.home()`, and Recent apps to `RestroSystem.recents()`. Each does exactly what RESTRO's
own navigation does. Going the other way, the page still calls `RESTRODevice.goHome()`, `goBack()` and
`openRecentApps()` when the app provides them.

## Going dark: `RESTRODevice.setScreenDark(on)`

After the idle time in Settings › Display (Go dark after, 5 minutes unless changed) the screen locks and goes black;
a double tap wakes it to the PIN pad. The black is the page's own, so it works on every device; call
`setScreenDark(true)` to turn the backlight down to its minimum and `setScreenDark(false)` to bring it back. The power
button still turns the display fully off (see Screen lock above).
