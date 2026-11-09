# RESTRO Android bridge: Wi-Fi and Bluetooth

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
and Closed once the order is also paid (at once, if it was paid upfront). Every restaurant has the kitchen screen for
now; subscription levels will decide it later, and without it orders are just Open, then Closed when paid.

**When a pager is docked back** in its docking station (connected to the main system), dispatch on the main system:

```js
window.dispatchEvent(new CustomEvent('restro:pager-docked', { detail: { number: 12 } }));
```

Only then is the pager released from its order: the order that has it (the one it was last handed to) is marked
`pagerBackAt`, its Buzz button goes grey with the number kept on it, and the pager shows as free in Counter's Assign
Pager. The mark syncs to the other tablets. Opened again in Counter, the order shows no pager: whatever pager is on it
when it is saved again is its pager, the same one handed back or another (then out with the customer, `pagerAt`), or
none (then it keeps the old number, still back, for the record). Handing a pager to an order also marks it back from
the order that had it (it can only be handed out once it is back). A held order's pager is released when it is held.

## Screen lock: `restro:device-locked` and `restro:device-unlocked`

Dispatch these as window events when the tablet's power button locks the screen (`ACTION_SCREEN_OFF`) and when it is
unlocked (`ACTION_USER_PRESENT`). With staff accounts set up, locking signs the person out and the lock screen asks for
a PIN.

## Printing the bill: `RESTRODevice.printer.printBill(bill)`

Counter's **Print bill** button (the printer, at the end of the order panel's top row) prints the bill. With this
method present, the bill goes to it, to print on the restaurant's bill printer; without it, the browser's own printing
opens. Return `false` (or throw) if it didn't print; Counter says so.

`bill` is plain data: `{ restaurant, number, at, type, table, customer, pager, lines, subtotal, tax, taxLabel, total }`.
`number` is the ticket (`"#05"`, or `null` for an order not saved yet), `at` the time in milliseconds, amounts in rupees.
Each line is `{ name, qty, each, total, modifiers, note }`: print `modifiers` (e.g. `"Medium spicy"`,
`"Extra gravy +₹40"`) and the `note` (free text for the kitchen) under their line. A custom item (typed in at the
Counter, not on the menu) is a line like any other: its name, or `"Custom item"`.

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

RESTRO has no bottom bar: a swipe bar instead (a black pill at the bottom centre), like an iPhone. Swiping up from the
bottom edge goes Home (the app closes into its icon), swiping up and holding (or a long, slow swipe up) opens Recent apps,
and swiping in from the left or right edge goes Back. When Android's gesture navigation is on and reaches the app first, forward it: the back gesture
(`OnBackPressedCallback`) to `RestroSystem.back()`, Home (when RESTRO is the tablet's home app, `onNewIntent` with
`CATEGORY_HOME`) to `RestroSystem.home()`, and Recent apps to `RestroSystem.recents()`. Each does exactly what the
swipe does in the page. Going the other way, the page still calls `RESTRODevice.goHome()`, `goBack()` and
`openRecentApps()` when the app provides them.
