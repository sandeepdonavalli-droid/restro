# RESTRO Android bridge

RESTRO runs in the RESTRO Android app's WebView. Browsers cannot list or join Wi-Fi networks, show Bluetooth devices
only in their own picker, and have no printers, pagers or texting, so the app fills those gaps in three ways:

- **Methods** on `window.RESTRODevice`, defined before the page loads. Every one is optional: the page checks for each
  and does without it (as noted). Any of them may return a Promise. Throw (or reject) with an `Error` and its message is
  shown to staff where a section says so.
- **Window events** the app dispatches into the page (`window.dispatchEvent(new CustomEvent(name, { detail }))`).
- **Calls into the page:** Android's Back, Home and Recent apps go to `window.RestroSystem`.

`python3 tools/check_bridge_doc.py` lists everything the page's code asks of the app and checks this file covers it.
Run it after any change to how the page talks to the app.

## Contents

| What | Kind | Section |
| --- | --- | --- |
| `wifi.isEnabled`, `wifi.setEnabled`, `wifi.scan`, `wifi.connect`, `wifi.disconnect` | methods | Wi-Fi |
| `bluetooth.isEnabled`, `bluetooth.setEnabled`, `bluetooth.startScan`, `bluetooth.connect`, `bluetooth.disconnect`, `bluetooth.getPairedDevices` | methods | Bluetooth |
| `getConnectivityStatus`, `subscribeConnectivityStatus`, `restro:connectivity-status` | methods, event | Connectivity |
| `getBatteryStatus`, `subscribeBatteryStatus`, `restro:battery-status` | methods, event | Battery |
| `setBrightness` | method | Brightness |
| `setVolume` | method | Sound |
| `openSettings` | method | Android's own settings screens |
| `getNotifications`, `subscribeNotifications`, `restro:notification`, `restro:notification-removed`, `restro:notifications` | methods, events | Notifications |
| `uninstallApp` | method | Uninstalling an app |
| `localSync.start`, `localSync.send` | methods | Sync between tablets |
| `sms.send`, `pager.buzz`, `restro:pager-docked`, `restro:pager-tapped`, `getPazzerDevices` | methods, events | Texting customers and buzzing pagers |
| `whatsapp.send`, `printer.newRoll`, `restro:printer-cover`, `integrations.markReady` | methods, event | Orders |
| `restro:device-locked`, `restro:device-unlocked` | events | Screen lock |
| `restro:keyboard` | event | The keyboard |
| `printer.printBill` | method | Printing the bill |
| `printer.printKot` | method | The kitchen printer |
| `printer.list` | method | The printers |
| `recommendedTimeout` | method | Messages |
| `printer.paperStatus`, `printer.subscribePaperStatus`, `restro:printer-paper` | methods, event | The bill printer's paper |
| `RestroSystem.back`, `RestroSystem.home`, `RestroSystem.recents`, `goHome`, `goBack`, `openRecentApps` | page calls, methods | Back, Home and Recent apps |
| `setScreenDark` | method | Going dark |
| `restro:device-ready` | event | The WebView |

## The WebView

- Load the page over **https**: the website, or the app's own copy of it through `WebViewAssetLoader`. The page uses
  WebCrypto (`crypto.subtle`) for the staff PINs' hashes and to seal sync messages, and it works only in a secure page.
- Turn on JavaScript and DOM storage: this tablet's orders, customers and settings live in `localStorage` until the
  backend exists (Phase 2).
- **Camera** (quick controls › Camera, `getUserMedia`): grant `VIDEO_CAPTURE` in `WebChromeClient.onPermissionRequest`,
  with Android's `CAMERA` permission.
- **Printing:** `window.print()` does nothing in a WebView. Provide `printer.printBill` (below); without it the page
  falls back to the browser's printing.
- `addJavascriptInterface` objects take and return only strings, numbers and booleans. Wrap them in a small script that
  builds `RESTRODevice` (Promises, callbacks and the stop functions included), run before the page's own scripts.
- **`restro:device-ready`:** if `RESTRODevice` can only be set up after the page has started, dispatch this event (no
  `detail`) once it is there. The battery, connectivity, notifications and paper level then connect to it; Wi-Fi,
  Bluetooth, printing, pagers and messages look `RESTRODevice` up each time they are used. Sync between tablets starts
  only when the page loads, so `localSync` must be there from the start.

## Wi-Fi: `RESTRODevice.wifi`

The Wi-Fi switch and networks in Settings › Wi-Fi and in quick controls › Wi-Fi. The page uses the app's Wi-Fi when
both `scan` and `connect` are there; otherwise it says this device's own settings manage its Wi-Fi.

| Method | Returns | Android API |
| --- | --- | --- |
| `isEnabled()` | `true` / `false` | `WifiManager.isWifiEnabled()` |
| `setEnabled(on)` | — | Drives the Wi-Fi switches in Settings. `WifiManager.setWifiEnabled` works for system/device-owner apps; otherwise open `Settings.Panel.ACTION_WIFI`. Without it the switch can't be changed here |
| `scan()` | `[{ ssid, level, secure, connected, saved }]` | `WifiManager.startScan()` + `getScanResults()`; `level` = `calculateSignalLevel(rssi, 5)` (0–4). Listed connected first, then by signal |
| `connect(ssid, password?)` | `true` / `false` | `WifiNetworkSuggestion` or `WifiNetworkSpecifier` (Android 10+). `password` is left out for an open or saved network; `false` shows "Couldn’t connect. Check the password and try again." |
| `disconnect()` | — | `ConnectivityManager.unregisterNetworkCallback` / remove suggestion |

Under the networks, **Open Android Wi-Fi settings** calls `openSettings('wifi')` (below) when the app has it.

The top bar's Wi-Fi icon and its signal bars come from Connectivity (below), not from these methods.

Permissions: `ACCESS_FINE_LOCATION` (or `NEARBY_WIFI_DEVICES` on Android 13+),
`ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`.

## Bluetooth: `RESTRODevice.bluetooth`

Settings › Bluetooth and quick controls › Bluetooth. The page uses the app's Bluetooth when both `startScan` and
`connect` are there; otherwise it uses the browser's Web Bluetooth where there is one.

| Method | Returns | Android API |
| --- | --- | --- |
| `isEnabled()` | `true` / `false` | `BluetoothAdapter.isEnabled()` |
| `setEnabled(on)` | — | Drives the Bluetooth switches. `BluetoothAdapter.enable()/disable()` for system/device-owner apps; otherwise `ACTION_REQUEST_ENABLE` |
| `startScan(onDevice)` | a `stop()` function (or an object with `stop()`) | `BluetoothLeScanner.startScan` and/or `BluetoothAdapter.startDiscovery()`; call `onDevice({ id, name, rssi })` per device. The page stops the scan after 15 seconds, or when staff tap Stop |
| `connect(id)` | `true` / `false` | `BluetoothDevice.createBond()` / `connectGatt()` / RFCOMM for printers. `false` (or an `Error`) shows that it didn't connect |
| `disconnect(id)` | — | `BluetoothGatt.disconnect()` / close socket |
| `getPairedDevices()` | `[{ id, name, connected }]` | `BluetoothAdapter.getBondedDevices()`; read when the panel opens. Those with `connected: true` show as connected, the others under Previously connected |

`rssi` (dBm) shows as Strong signal (above −60), Good signal (above −80) or Weak signal.

Permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (Android 12+), `ACCESS_FINE_LOCATION` (older).

All methods may return promises. Throw an `Error` with a short message to show it to the user.

## Connectivity: `RESTRODevice.getConnectivityStatus()` and `subscribeConnectivityStatus(callback)`

The top bar's Online / Offline pill, its Wi-Fi and mobile-signal icons, and Settings › Network & internet.

| Member | Returns | Notes |
| --- | --- | --- |
| `getConnectivityStatus()` | a status (or a Promise of it) | Read at start, every 5 seconds while the page is on screen, when it comes back on screen, when the tablet comes back online, and when staff tap Check now (Settings › Network & internet) |
| `subscribeConnectivityStatus(callback)` | a function that stops it | Call `callback(status)` on every change |

Or dispatch `restro:connectivity-status` with the status as `detail` (or call `RestroConnectivity.update(status)`).
A status is plain data (a JSON string of it is fine too):

```js
{
  internetAvailable: true,          // the tablet can reach the internet (NET_CAPABILITY_VALIDATED): Online / Offline
  transport: 'wifi',                // what the internet goes through: 'wifi', 'cellular', 'ethernet' ...
  wifi: { connected: true, level: 3, internetAvailable: true },  // level 0-4: the bars; false: the "no internet" mark
  hasCellular: true,                // the tablet has a SIM: the mobile signal icon shows
  cellular: { connected: false, level: 2 }                       // level 0-4, or null when not known
}
```

Send only what you know: a field left out keeps its last value. The flat names `wifiConnected`, `wifiLevel`,
`wifiInternetAvailable`, `cellularLevel` and `validated` (for `internetAvailable`) are read too. Settings › Network &
internet shows Connected through **Wi-Fi** or **Mobile data** from `wifi.connected` and `cellular.connected`.

Without these, the page checks the internet itself every 30 seconds (and whenever the connection changes) by loading
`connectivity-check.txt` from its own server, and takes Wi-Fi or mobile data from Capacitor's Network plugin when the
app has one (`Capacitor.Plugins.Network`, or one passed to `RestroConnectivity.attachNetworkSource(plugin)`).

## Battery: `RESTRODevice.getBatteryStatus()` and `subscribeBatteryStatus(callback)`

The battery in the top bar (Settings › Display › Battery: Percentage or Fill). 20% or less and not charging, it turns
red; charging, green with a bolt.

| Member | Returns | Notes |
| --- | --- | --- |
| `getBatteryStatus()` | a status (or a Promise of it) | Read at start and whenever the page comes back on screen |
| `subscribeBatteryStatus(callback)` | a function that stops it | Call `callback(status)` on every change (`ACTION_BATTERY_CHANGED`) |

Or dispatch `restro:battery-status` with the status as `detail` (or call `RestroBattery.update(status)`). A status:
`{ percentage: 78, plugged: false }`, where `percentage` is 0–100 (or `level`, 0–1) and `plugged` is `true` / `false`
or `BatteryManager.EXTRA_PLUGGED` (more than 0: plugged in; or `charging`, `true` / `false`). `{ hasBattery: false }`
hides the battery. Without any of these the page uses the browser's battery, when it has one.

## Brightness: `RESTRODevice.setBrightness(level)`

Optional. `level` is 20–100 from the Brightness sliders (Settings › Display and quick controls). Set the screen's
brightness: the window's `screenBrightness` (`level / 100`), or `Settings.System.SCREEN_BRIGHTNESS` with
`WRITE_SETTINGS`. Until it resolves the page dims itself with a black layer; once it has resolved, the page's layer
goes and the real brightness does the work. Reject, and the page keeps its own layer.

## Sound: `RESTRODevice.setVolume(level)`

Optional. `level` is 0–100 from the Volume sliders (Settings › Sound and quick controls).
Map it to `AudioManager.setStreamVolume(STREAM_MUSIC, level * max / 100, 0)`.

## Android's own settings screens: `RESTRODevice.openSettings(kind)`

Opens one of Android's (or a hardware maker's) settings screens over RESTRO:

| `kind` | Where staff tap it |
| --- | --- |
| `"wifi"` | **Open Android Wi-Fi settings**, under the networks (Settings › Wi-Fi, quick controls › Wi-Fi) |
| `"pazzer"` | **Pazzer settings** in Pager Hub (quick controls), for the pager hardware |

Return `false` (or throw) when it couldn't open: Pager Hub then shows "Device settings could not be opened. Please
try again." (or the `Error`'s message). Without it, Pager Hub says to open these controls on the RESTRO Android device.

## Notifications: `RESTRODevice.getNotifications()` and `subscribeNotifications(callback)`

Android's notifications, listed in quick controls (pull down from the top banner) with their count. Each is plain data:

```js
{ id: 'n-42', title: 'Low storage', message: 'Free up space ...', source: 'System', appId: 'orders', timestamp: 1762510680000 }
```

`title` is needed (up to 240 characters); `message` (or `body`, up to 2,400), `source` (up to 80, "System" when left
out), `appId` (one of RESTRO's apps, to show its icon; otherwise a bell) and `timestamp` (or `receivedAt`: milliseconds
or a date string; now when left out) are optional. `id` replaces the one with the same id; without it each is new.

| Member | Returns | Notes |
| --- | --- | --- |
| `getNotifications()` | every notification now, `[...]` | Replaces the list. Read at start and each time quick controls open |
| `subscribeNotifications(callback)` | a function that stops it | `callback(notification)` adds one; `callback({ type: 'remove', id })` takes one off; `callback([...])` or `callback({ type: 'snapshot', notifications: [...] })` replaces them all |

Or dispatch `restro:notification` (`detail`: one), `restro:notification-removed` (`detail`: `{ id }` or the id) and
`restro:notifications` (`detail`: all of them).

## Uninstalling an app: `RESTRODevice.uninstallApp(id)`

On the home screen, while the apps are being arranged (hold an app), staff can uninstall an app: "Uninstall "…"?" ·
Yes. With this method the app removes the app's package first: `id` is RESTRO's id for the app. Return `false` or
`{ success: false }` (or throw) when it couldn't: the page shows "The app could not be uninstalled. Please try again."
(or the `Error`'s message) and keeps it. Otherwise the app goes from the home screen. Without this method it just goes
from the home screen.

## Sync between tablets: `RESTRODevice.localSync`

Lets the restaurant's tablets sync over its own Wi-Fi or Bluetooth, with or without the internet (see SYNC.md). The page
seals every message itself; the app only finds the other tablets and carries text between them.

| Method | Returns | What the app does |
| --- | --- | --- |
| `start(info, onMessage, onPeers)` | a `stop()` function (or an object with `stop()`) | Nearby Connections with `Strategy.P2P_STAR` and `info.service` as the service id: the main system (`info.main`) advertises and accepts, the other tablets discover and connect to it. Put `{ deviceId, name, main }` in the endpoint info so each side knows the other's device id. Calling `start` again replaces the previous session (the device name or role changed) |
| `send(text, toDeviceId)` | — (may be a promise) | Sends `text` to one tablet, or to every connected tablet when `toDeviceId` is `null`. Messages can reach about 300 kB: use `Payload.Type.STREAM`, or split into 32 kB byte payloads and join them before `onMessage`. Reject when it can't send |

`info` is `{ deviceId, name, main, service, protocol }`.

- `onMessage(fromDeviceId, text)`: call it for every whole message received, with the sender's device id.
- `onPeers([{ id, name, main }])`: call it with the connected tablets whenever that list changes (`[]` for none).

The page calls `start` when it loads, and again when this tablet's name, its Main system switch or its pairing changes
(Settings › Devices). Accept connections automatically: the page drops anything not sealed with the restaurant's key.
Keep the session running while the app is open (a foreground service) and reconnect after network changes. A LAN
version (NSD discovery and a WebSocket) can sit behind the same two methods.

Permissions: `NEARBY_WIFI_DEVICES` (Android 13+); `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`
(Android 12+); `ACCESS_FINE_LOCATION` (older); `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`.

## Texting customers and buzzing pagers: `RESTRODevice.sms` and `RESTRODevice.pager`

Optional. Orders has a **Notify** button and a **Buzz** button on every order, whatever the payment status (a delivery
app's order has **Ready** in Notify's place): Notify texts the customer, on WhatsApp or SMS, when the order has their
phone number; Buzz buzzes the order's pager while it is out. Without these, the buttons say that messages or pagers
start with the RESTRO Android app.

| Method | Returns | What the app does |
| --- | --- | --- |
| `sms.send({ to, code, text, order })` | `true` / `false` (may be a promise) | Sends `text` to `+code to` (`code` is the country code, `"91"` unless the customer's number has another). `SmsManager` on the tablet (`SEND_SMS`), or an SMS service once the cloud exists. `order` is the order's id (`uid`), for a log. `false` (or an error) shows "The message didn’t go" with Retry |
| `pager.buzz(number)` | `true` / `false` (may be a promise) | Buzzes pager `number` through the restaurant's paging transmitter (USB, Bluetooth or the network, depending on the pager system). **Resolve only once the pager system confirms the pager buzzed** (Update Pack 4): until then Orders shows "Buzzing pager 12… · ‹customer or table›, Order #1015" and keeps the Buzz button from being tapped again; `true` shows "Pager 12 buzzed · …" and the short green bar under Buzz (kept on the order as `buzzedAt`, synced to every tablet); `false` (or an error) shows "Pager 12 didn’t respond · check it’s charged and in range" with RETRY. Pager Hub's tiles on the home screen buzz it too ("Pager 12 buzzed" / "Pager 12 didn’t buzz") |

The texts (Orders › Notify), with the restaurant's name (Settings › Business details):
- **Order ready:** "Hi <name>, your order #1015 from <restaurant> is ready." (dine-in); "… is ready and will be with
  you soon." (delivery); "… is ready for pickup. Please show this message at the counter." (takeaway, phone orders).
- **Bill:** "Hi <name>, the bill for your order #1015 from <restaurant> is ₹837."
- **Running late:** "Hi <name>, your order #1015 from <restaurant> is running a little late. We’ll message you as soon as
  it’s ready."

("Hi," when the order has no name; no "from …" without a restaurant name.)

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

**The pager hardware: `RESTRODevice.getPazzerDevices()`.** Pager Hub (quick controls) lists the restaurant's Pazzer
hardware: return `[{ name, connected }]` (or a Promise of it), shown as "Connected" or "Disconnected" ("Pazzer device"
when it has no name; "No Pazzer hardware connected" for none). Its **Pazzer settings** button calls
`openSettings('pazzer')` (above).

## Orders (Update Pack 3): WhatsApp, the paper roll, delivery apps

| Method or event | |
| --- | --- |
| `RESTRODevice.whatsapp.send({ to, code, text, order })` | Optional, like `sms.send`: Notify's WhatsApp. Return `true` / `false` (may be a promise); `false` falls back to SMS |
| `RESTRODevice.printer.newRoll()` | Staff confirmed a new paper roll in the bill printer: reset its paper level to 100% (and tell the other tablets through `restro:printer-paper`) |
| `restro:printer-cover`, `{ printer, level }` | Dispatch when the bill printer's cover was opened and closed: Orders asks "New paper roll?" (`printer`: its name; `level`: the level before) |
| `RESTRODevice.integrations.markReady({ platform, id, order })` | A delivery app's order marked ready in Orders (Ready → Marked): tell the platform (`"swiggy"`, `"zomato"`; `id` its order number; `order` RESTRO's id for the order), once the integrations exist. **Return `true` once the platform accepted it, `false` if it didn't** (may be a promise; Update Pack 4): `true` turns the button to Marked and shows "Order ready sent to Swiggy · Swiggy #4521 · Order #1029"; `false` (or an error) keeps Ready and shows "Swiggy didn’t receive “Ready” · Swiggy #4521 · Order #1029" with RETRY. Offline, Orders doesn't call it and shows "Offline · couldn’t send “Ready” to Swiggy · Order #1029" with RETRY. There is no "are you sure" |

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

Counter's **Print bill** button (the printer, at the end of the order panel's top row) prints the bill; Orders' Bill /
Receipt button prints a saved order's bill (not paid yet) or receipt (paid). With this method present, the bill goes to
it, to print on the printer whose role is **Bills** or **Both** (Settings › Printers); without it, the browser's own
printing opens. Return `false` (or throw) if it didn't print: Counter says "The bill didn’t print", Orders offers
Retry. After each bill the page reads the paper level again (below).

Print it as `25_printed-bill` (Counter Update 7, the customer's copy, the same for every kind of order), 80 mm,
**black only**:

- **Header:** `restaurant` (large), `address`, then the restaurant's phone · email (`phone`, printed `+91 98765
  43210`, and `email`, Settings › Business details; Update Pack 3), then `GSTIN …` · `FSSAI …` (`gstin`, `fssai`: the
  FSSAI licence number is required on bills in India). Each is `""` when not set: leave its line out. A dashed rule,
  **TAX INVOICE**, then `Bill #B-2045 · Order #1015` (`bill`: the bill's own number, `"B-2045"`, one series for the
  restaurant starting again at B-1 each financial year (1 April), given at the first print or at the payment, `null`
  before; `number`: the order's ticket, e.g. `"#1015"`, or `null` for an order not saved yet) and the date and time
  (`at`, milliseconds, printed `7 Nov 2026 11:58 AM`), then `type` (`"Dine-in"`, `"Takeaway"`, `"Delivery"`,
  `"Phone call"`) · `Table …` (`table`, `""` for none) · `… guests` (`guests`, 0 for none), and `Server: EC` (the
  initials of `server`, the full name).
- **Dishes:** each of `lines`, `{ name, qty, each, total, modifiers, note, discount }`: `2 × Sweet lassi` and its
  `total` (`each` is one's price); its `modifiers` under it on one line (`"Half · Medium spicy"`); its dish discount,
  when it has one, as an indented minus line: `discount.label` and −`discount.amount` (`"10% off"` −26.00, `"100% off ·
  Complaint"` −180.00; `discount` also has `percent` and, for 100% off, `reason`). Dish notes (`note`) are for the
  kitchen and are not on the customer's bill. A custom item is a line like any other.
- **Sums, in this order:** Subtotal (`subtotal`: after the dish discounts); the order discount (`discount`:
  `{ label, percent, amount }`, `"Discount 10%"`, printed as −84.40); the service charge (`serviceCharge`:
  `{ label, percent, amount }`, `"Service charge 5% (optional)"`); `packaging` and `delivery` (`{ label, amount }`);
  each of `taxes` on its own line (`"CGST 2.5%"` and `"SGST 2.5%"`, with their amounts); `roundOff` when it isn't 0
  (`"Round off −0.46"`; `+` when it rounds up); then **GRAND TOTAL** `total` (to the rupee). `discount`,
  `serviceCharge`, `packaging` and `delivery` are `null` when the order hasn't got them; `roundOff` is 0. (`tax` and
  `taxLabel` are the two taxes together, `"GST 5%"`.)
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
| `paid` | receipts only: `{ method, amount, at, ref }`, a boxed line above the footer, `"PAID · UPI ₹837"` and under it `"7 Nov 2026 12:41 PM · Ref 4318 9920 1187"` (`method`: `"Cash"`, `"UPI"`, `"Card"`, `"Swiggy"` or `"Zomato"`; `ref` only when the payment has one) |

Each print is kept on the order (`bills`, `receipts`: `{ at, by, total }`), so the next one is a REPRINT on every tablet.

## The kitchen printer: `RESTRODevice.printer.printKot(slip)`

Counter Update 7. **Save sends the KOT, and so does Pay**; each KOT has only the dishes the kitchen doesn't have yet
(a later KOT has only what was added after the earlier ones). KOT numbers run through the business day for the whole
restaurant: the day's first KOT is #1, starting again at 4 AM with the order numbers. After a KOT has gone, taking a
dish off or reducing it prints a **VOID** slip, deleting the order prints **ORDER CANCELLED** (both with the reason
staff gave), changing a dish's choices or note prints a **CHANGED** slip, and marking the order as priority prints a
short **★ PRIORITY** notice. Counter's **Reprint KOT** (the order menu) sends the order's last KOT again, as it was.
Orders' KOT button reprints the KOTs staff tick, each with the REPRINT box (`reprint`, below); a KOT that never printed
prints as it was. Orders can also send the dishes the kitchen doesn't have yet as a new KOT.

**Scheduled orders** (Update Pack 4, Counter scheduling). An order with a ready-by time is saved either with **Schedule
KOT** (`kotMode: "queue"`: its KOT prints by itself at the kitchen time, ready-by less that order type's prep time in
Settings › Kitchen; if the prep time is changed later the KOT can only move earlier, never later) or **Instant KOT**
(`kotMode: "now"`: its KOT prints with Save or Pay, as for any order). A queued KOT has no number until it prints; it
takes the day's next KOT number then. It is printed by the tablet that saved the order last, at the kitchen time; if
that tablet hasn't printed it 30 seconds later, the main system prints it, and 2 minutes later any tablet that is on,
so it prints even when the tablet that saved it is off (and the moment one comes on). While the order is on hold
nothing prints. Deleting it before its KOT has printed prints nothing in the kitchen. Once the KOT has printed, a new
ready-by time prints a **TIME CHANGED** slip (`kind: "time"`, below) and dishes added later go on a new KOT.

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
| `kind` | `"kot"`, `"void"`, `"changed"`, `"cancel"`, `"priority"`, `"time"` (TIME CHANGED, Update Pack 4) or `"cancel-bulk"` (below) |
| `band` | the black band at the top: `"DINE-IN"`, `"TAKEAWAY"`, `"DELIVERY"`, `"PHONE ORDER"` (`type` is the order type: `"dine-in"`, `"takeaway"`, `"delivery"`, `"phone"`) |
| `action` | the red outlined box under it, or `null` for a plain KOT: `"★ PRIORITY"` (also on every KOT of an order marked as priority), `"VOID"`, `"CHANGED"`, `"ORDER CANCELLED"`, `"TIME CHANGED"` |
| `title`, `where` | bold: `"KOT #3 · Order #1015"` (on VOID and CHANGED, the KOT the dish was on; on ORDER CANCELLED `"Order #1015 · Table 12"` and `where` is `""`; on TIME CHANGED `"Order #1033 · Table 6"` and `where` the new time, `"Ready by 10:30 PM"`), then `"Table 12"` / `"Pager 18"` / `"Pickup 1:15 PM"` (`kot` is the KOT's number, `null` on TIME CHANGED; `order` the ticket) |
| `info` | small: `"4 guests · 11:46 AM · Server: EC"`; for takeaway, delivery and phone orders the customer's name and masked phone (`"98xxxxxx10"`), the time and the server's initials; on VOID and CHANGED `"11:52 AM · By: EC"`; on ORDER CANCELLED `"VOID ALL · KOT #141, #152 · 12:05 PM · By: EC"`; on TIME CHANGED `"was 10:00 PM · KOT #163 sent 9:30 PM · 9:41 PM · By: RK"` (the ready-by time before, when the KOT went, now, who) |
| `at` | when it happened, milliseconds |
| `note` | the order note, in a red box (`"ORDER NOTE: …"`), on every KOT and the priority notice; `""` for none |
| `lines` | (none on TIME CHANGED: the dishes don't change) `{ qty, name, names, mods, note }`: `qty × name` bold (minus quantities on VOID and ORDER CANCELLED: `−8 ×`), quantities right-aligned in a fixed column; then every one of `mods` on its own line, right-aligned, red (on a CHANGED slip these are the changes: `"Medium spicy → Less spicy"`, `"+ No onion"`, `"− Less oil"`, `"+ Note: …"`); the dish's `note` last, red italic, right-aligned (`"Note: …"`). `names` is the dish's names in other languages, set on the dish in Inventory (`{ te: "…" }`), or `null`. The priority notice has no lines |
| `footer` | small, at the end: `"KOT #141, #152 sent earlier · only new dishes on this KOT"`, `"Priority · cook this order first"`, `"No dish changes · cook as already sent"` (TIME CHANGED), or `"Reason: Customer changed mind"` |
| `reason`, `by` | the reason staff gave (`""` for none) and who did it (their full name, or `null`) |
| `priority` | true when the ★ PRIORITY box is on it |
| `printers` | Settings › Printers: `[{ id, language, copies }]` for the kitchen printers |
| `reprint` | KOTs reprinted from Orders (Update Pack 3): `{ at, by }` (`by`: initials), the red **REPRINT** box with the time and initials, and **(R)** after every dish (Update Pack 1); `undefined` otherwise |

- **Red** (modifiers, dish notes, the order note, the action box, the **REPRINT** box) prints red on two-colour printers
  (red/black ribbon or two-colour thermal paper) and black on black-only printers: the same slip, only the colour
  changes. (Whether a printer has red will be a setting in Settings › Printers, to come.)
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
never reached the kitchen."`), `reason`, `by` (as above) and `printers`. A single order deleted prints its ORDER
CANCELLED slip as before; none prints when none of the orders reached the kitchen.

## The printers: `RESTRODevice.printer.list()`

Settings › Printers lists the printers the app knows (the main system's): return `[{ id, name, connection }]` (or a
Promise of it), `connection` e.g. `"Bluetooth"`, `"Wi-Fi"`, `"USB"`. Each printer's role (`"bills"`, `"kitchen"` or
`"both"`: Bills, Kitchen (KOT) or Both), KOT language and copies are set there and kept in `restro.printers.v1`
(`{ <id>: { role, language, copies } }`, the same on every tablet), which the page passes with each slip. A printer not
set yet is Both, English, 1 copy.

## Messages: `RESTRODevice.recommendedTimeout(ms, hasControls)`

Counter's messages go after 2 s (a confirmation) or 4 s (one with Undo); errors stay. Return Android's
`AccessibilityManager.getRecommendedTimeoutMillis(ms, flags)` (with `FLAG_CONTENT_TEXT`, plus `FLAG_CONTENT_CONTROLS`
when `hasControls` is true), so the "Time to take action" accessibility setting is respected. Return the number
straight away (not a Promise); one shorter than `ms` is not used. Without it the times are as above.

## The bill printer's paper: `RESTRODevice.printer.paperStatus()` and `subscribePaperStatus(callback)`

The Print bill button (Counter) and the Bill / Receipt buttons (Orders) show how much paper the bill printer has left:
the light blue drains from the top as the roll is used; at 20% or less (or when the printer's near-end sensor says so)
the button turns amber (in Orders only the paper left is amber, with an amber edge: Update Pack 4, P07) and Orders
shows "Bill printer paper low · 18% left · keep a new roll ready" once, as it runs low; out of paper (or the cover
open) the button turns red with a "!"; with the printer offline it is grey, crossed out. A tap still prints; when it
doesn't, Orders says why from this status: "Bill printer offline · check its power and cable" with RETRY (C5), or
"Bill printer is out of paper" (C6).

Report it for the printer whose role is **Bills** or **Both** (Settings › Printers); a kitchen-only printer is never
shown. Each status is plain data, `{ level, state }`: `level` the paper left, 0–100 (%); `state` one of `"ok"`,
`"low"`, `"out"`, `"offline"`.

| Member | Returns | Notes |
| --- | --- | --- |
| `paperStatus()` | `{ level, state }` (or a Promise of it) | Read when the page starts, each time Orders opens, and after each bill |
| `subscribePaperStatus(callback)` | a function that stops it | Call `callback({ level, state })` on every change |

Or dispatch a `restro:printer-paper` window event with the same `detail`. Without any of these the button shows a full
roll.

Work the level out as `PaperEstimator` does (Counter Update 5, `CounterUpdate5.kt`):

- The roll's size is set in the printer's settings (e.g. 80 mm × 50 m). After every print, take off what was printed
  (its lines × the line height, plus the feed and the cut). A **Both** printer counts bills and kitchen tickets.
- Poll the printer's status (ESC/POS `DLE EOT`) every 10 seconds and after every job: near-end means `"low"`, paper-end
  or the cover open `"out"`, no answer `"offline"`.
- Start again at 100% when paper-end was reported and the cover was then opened and closed, or when staff tap **New roll
  fitted** in the printer's settings (or confirm "New paper roll?" in Orders: `printer.newRoll()`, above).

## Back, Home and Recent apps: `RestroSystem.back()`, `.home()`, `.recents()`

RESTRO runs end to end on the 1920 × 1080 panel as the tablet's home app in lock-task (kiosk) mode: hide Android's own
status bar and navigation bar. RESTRO draws its own navigation (Settings › Display › Navigation): **swipe** (the
default: a black pill at the bottom centre; swipe up from the bottom edge for Home, swipe up and hold for Recent apps,
swipe in from the left or right edge for Back) or a **navigation bar** (56 px, black: Back, Home and Recent apps, Back on
the left or the right), with a lock button in both. When Android's gesture navigation still reaches the app first,
forward it: the back gesture (`OnBackPressedCallback`) to `RestroSystem.back()`, Home (`onNewIntent` with
`CATEGORY_HOME`) to `RestroSystem.home()`, and Recent apps to `RestroSystem.recents()`. Each does exactly what RESTRO's
own navigation does.

Going the other way, the page calls these when the app provides them:

- `goBack()`: when Back has nothing left to do in RESTRO (no keyboard, pop-up or app open, on the first home page).
- `goHome()`: after RESTRO has gone to its home screen.
- `openRecentApps()`: first, whenever Recent apps is asked for. Anything but `false` means the app showed its own
  Recent apps and RESTRO doesn't show its; in kiosk mode leave it out (or return `false`) so RESTRO's own shows.

## Going dark: `RESTRODevice.setScreenDark(on)`

After the idle time in Settings › Display › Navigation (Go dark after, 5 minutes unless changed) the screen locks and goes black;
a double tap wakes it to the PIN pad. The black is the page's own, so it works on every device; call
`setScreenDark(true)` to turn the backlight down to its minimum and `setScreenDark(false)` to bring it back. The power
button still turns the display fully off (see Screen lock above).
