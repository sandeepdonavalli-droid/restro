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
| `whatsapp.send`, `printer.newRoll`, `restro:printer-cover`, `integrations.markReady`, `restro:platform-cancelled` | methods, events | Orders |
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
| (nothing to add in the app) | what staff see | Orders and the Counter (Update Pack 5): payment status names, order-type icons, QR orders, readability, QR payment Pending, home-screen badges |
| `printer.printQr`, `qr.send`, `restro:qr-path`, `restro:qr-scan`, `RestroQrStudio.path`, `RestroQrStudio.scanned` | methods, events, page calls | QR Studio (Update Pack 5) |

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
| `sms.send({ to, code, text, order })` | `true` / `false` (may be a promise) | Sends `text` to `+code to` (`code` is the country code, `"91"` unless the customer's number has another), **through the restaurant's SMS service with DLT registration, from the backend (Phase 2); never from the tablet's own SIM** (owner, 12 Nov 2026). `order` is the order's id (`uid`), for a log. Resolve `true` once the service accepted it: "Sent to ‹name› on SMS · Order #1028 ready for pickup", and the short line under Notify is **green** (kept on the order as `notifiedAt`). `false` (or an error): "Couldn’t send the SMS to ‹name› · Order #1028 · the SMS service didn’t answer" with RETRY, and the line under Notify is **red** (`notifyFailedAt`) until a message goes (owner, 12 Nov 2026: by hand or by itself) |
| `pager.buzz(number)` | `true` / `false` (may be a promise) | Buzzes pager `number` through the restaurant's paging transmitter (USB, Bluetooth or the network, depending on the pager system). **Resolve only once the pager system confirms the pager buzzed** (Update Pack 4): until then Orders shows "Buzzing pager 12… · ‹customer or table›, Order #1015" and keeps the Buzz button from being tapped again; `true` shows "Pager 12 buzzed · …" and the short green line under Buzz (kept on the order as `buzzedAt`, synced to every tablet); `false` (or an error) shows "Pager 12 didn’t respond · check it’s charged and in range" with RETRY, and the line under Buzz turns **red** (`buzzFailedAt`, synced) until a buzz goes (owner, 12 Nov 2026). Pager Hub's tiles on the home screen buzz it too ("Pager 12 buzzed" / "Pager 12 didn’t buzz") |

The texts (Orders › Notify), with the restaurant's name (Settings › Business details):
- **Order ready:** "Hi <name>, your order #1015 from <restaurant> is ready." (dine-in); "… is ready and will be with
  you soon." (delivery); "… is ready for pickup. Please show this message at the counter." (takeaway, phone orders).
- **Bill:** "Hi <name>, the bill for your order #1015 from <restaurant> is ₹837."
- **Running late:** "Hi <name>, your order #1015 from <restaurant> is running a little late. We’ll message you as soon as
  it’s ready."
- **Order scheduled** (Update Pack 4; first in the pop-up while a scheduled order's KOT waits): "Hi <name>, your order
  #1015 from <restaurant> is booked for 8:30 pm today. We’ll have it ready on time." ("tomorrow", or "on Wed 11 Nov",
  for another day.)

("Hi," when the order has no name; no "from …" without a restaurant name.)

These wordings, with the name, the order number, the restaurant's name, the amount and the time as their variables, are
what gets registered on DLT for SMS (Service category) and with Meta as WhatsApp templates. DLT blocks any message that
doesn't match its registered template exactly, so a word changed here has to be registered again before it can go.

**When the kitchen marks an order complete** (with the kitchen screen, to build), both go out on their own: the text
if the order has a phone number, the buzz if it has a pager out. With neither, nothing happens. The main system sends
them (a tablet working on its own sends its own), so each goes out once however many tablets there are (orders.js,
built 12 Nov 2026, tried with a pretend Done mark):
- **The text** is Notify's "Order ready" (below), by **Settings › Orders › Order-ready message**: SMS (the default),
  WhatsApp (falls back to SMS) or Off (`restro.readyMessage.v1`, the restaurant's, synced). Off stops only the text;
  the pager still buzzes.
- **Once for each Done mark:** the order keeps which Done mark it handled (`readyAutoFor`, the `kitchenDoneAt` it
  went out for) and when (`readyAutoAt`), written before anything goes out, so a tablet that stops halfway doesn't send
  twice. A delivery app's order is left out (it has Ready instead of Notify), and so is a Done mark more than 30 minutes
  old (a main system that was off when the kitchen marked it).
- **The result** shows in the bar at the bottom of the sending tablet, as for Notify and Buzz by hand: in Orders if it
  is open, else on the Counter, with RETRY when it didn't go. A failure no one saw waits for Orders or the Counter to
  open there; a success never covers a failure still showing. On every tablet the line under Notify or Buzz turns
  green when it went, red when it didn't.
- **Dishes added after the order was ready** (owner, 13 Nov 2026): only an order that isn't paid yet can take more
  dishes. They go to the kitchen on a new KOT, and the order is In kitchen again (`kitchenDoneAt` is cleared). The
  dishes the kitchen already finished stay finished: with 5 dishes done and 2 added, the kitchen screen keeps the 5
  ticked and shows only the 2 new ones as not done (a dish's done mark, once set, is never cleared, and merging keeps
  it). When the 2 are ticked, the order is done again: the "ready" text goes again, and the pager buzzes again if the
  customer still has it, even when the customer paid while the new dishes were cooking. A paid order doesn't open on the Counter: more food
  for that customer is a new order with its own number, its own "ready" text, and the pager taken back from the first
  order and given to the new one.
- **Trying it without a SIM or a pager:** a stand-in `RESTRODevice` whose `sms.send`, `whatsapp.send` and `pager.buzz`
  only record what they were given and return `true` or `false`, and a `kitchenDoneAt` written on an order followed by
  `restro:data-changed` (`{ collections: ['orders'] }`), the way the kitchen screen's mark arrives.

The two buttons stay, to send again by hand: Text whenever the order has the customer's phone number, whatever its status,
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
back from the other). A held order's pager is released when it is held. The question names the other order and how it
stands: "Pager 7 is still with #1031", then "‹customer› · Due · In kitchen". Its payment is in Orders' words and colours
(owner, 12 Nov 2026): **Due** orange, **Part paid** red, **Paid** black (Midnight: the same orange, red and white as
Orders' Midnight), in every menu display style of the Counter and every theme; see "Orders and the Counter (Update
Pack 5)" below.

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
| `RESTRODevice.whatsapp.send({ to, code, text, order })` | Optional, like `sms.send`: Notify's WhatsApp, **through the WhatsApp Business Platform (Meta) from the backend (Phase 2)**, the texts registered and approved as its message templates (owner, 12 Nov 2026). Return `true` / `false` (may be a promise); `false` falls back to SMS |
| `RESTRODevice.printer.newRoll()` | Staff confirmed a new paper roll in the bill printer: reset its paper level to 100% (and tell the other tablets through `restro:printer-paper`) |
| `restro:printer-cover`, `{ printer, level }` | Dispatch when the bill printer's cover was opened and closed: Orders asks "New paper roll?" (`printer`: its name; `level`: the level before) |
| `RESTRODevice.integrations.markReady({ platform, id, order })` | A delivery app's order marked ready in Orders (Ready → Marked): tell the platform (`"swiggy"`, `"zomato"`; `id` its order number; `order` RESTRO's id for the order), once the integrations exist. **Return `true` once the platform accepted it, `false` if it didn't** (may be a promise; Update Pack 4): `true` turns the button to Marked and shows "Order ready sent to Swiggy · Swiggy #4521 · Order #1029"; `false` (or an error) keeps Ready and shows "Swiggy didn’t receive “Ready” · Swiggy #4521 · Order #1029" with RETRY. Offline, Orders doesn't call it and shows "Offline · couldn’t send “Ready” to Swiggy · Order #1029" with RETRY. There is no "are you sure" |
| `restro:platform-cancelled`, `{ platform, id, payout, payoutAmount }` | Update Pack 4. Dispatch when a delivery app cancels one of its orders: `platform` (`"swiggy"`, `"zomato"`), `id` (the app's order number, `"4521"`), and when the app gives them `payout` (`"awaiting"`, `"paid"` or `"unpaid"`) and `payoutAmount` (paise). The order stays and Orders shows it as **Cancelled by Swiggy**. If its KOT has printed, the page prints the **ORDER CANCELLED** slip by itself (the kitchen printer, below: `"By: Swiggy"`, `"Reason: Cancelled by Swiggy"`); if it hasn't, nothing prints. Sending it again for the same order does nothing. Dispatch it on one tablet only, the one that runs the delivery-app integrations: the other tablets get the change through sync |

## Orders and the Counter (Update Pack 5): payment status names, order-type icons, QR orders, readability, QR payment Pending, home-screen badges

Nothing here asks anything new of the app: it is what staff see, the options they have and the data behind it, for the
Android app and the backend to match. Every Orders change is in **all 12 layouts**: Classic, Classic pills, Split,
Split pills, Cards and Cards pills, each in **Light and Midnight**, with one value per theme (identical across that
theme's 6 layouts). Built 12 Nov 2026 (Update Pack 5, part 1); QR payment Pending and the home-screen badges 13 Nov
2026 (part 3).

### Payment status names (Update 4.1: names only; workflows, rules and colours unchanged)

Each order shows one payment status, worked out from the order (orders.js `payOf`):

| Status | When | Light | Midnight | Counts in |
| --- | --- | --- | --- | --- |
| **Paid - UPI** (the method; several joined: "Paid - UPI + Cash") | `paidAt` set. Methods: Cash, UPI, Card, Net banking, Wallet, Swiggy, Zomato (`method`, or `methods` for several) | black `#1C1917` | `#F1F4FA` | Total, on the day it was paid |
| **Due** (was "Not paid") | not paid | orange `#C2410C` | `#FFA066` | Due |
| **Part paid** (was "Partially paid"; no method) | `paidAmount` (paise) more than 0 and less than the total, `paidAt` not set. "₹X due" under it | red `#D92D20` | `#FF9C9C` | what was paid in Total, the rest in Due |
| **Refunded - Cash** | `refundedAt` set, the whole amount | red | `#FF9C9C` | neither |
| **Partial refund - Card** | `refundAmount` less than the total ("₹X refunded" under it; `refundMethod`) | red | `#FF9C9C` | what was kept, in Total |
| **Complimentary** | paid, total ₹0 | black | `#F1F4FA` | neither |
| **Awaiting Swiggy** | a delivery app cancelled it, `payout: 'awaiting'` | grey `#78716C` | `#8D97AB` | neither |
| **Paid - Swiggy** | cancelled, `payout: 'paid'` (`payoutAmount`) | black | `#F1F4FA` | Total |
| **Unpaid - Swiggy** (was "Not paid - Swiggy") | cancelled, `payout: 'unpaid'`: the app refused to pay, so the money will never be collected | red | `#FF9C9C` | **not** Due |
| **Pending** (a QR order, Update Pack 5 H1) | `qr: true`, `qrPay: 'pending'`: its payment hasn't reached us and the cloud can't be reached | Due's orange `#C2410C` | `#FFA066` | Due |
| **Refunded** (a QR order staff cancelled) | `qrPay: 'refund'`; "Refunded - UPI" once the cloud has refunded it | red | `#FF9C9C` | neither |
| **Payment failed** (a QR order, owner 13 Nov 2026) | `qrPay: 'failed'`, `paidAt` not set: staff saw it paid, the cloud found no payment | red | `#FF9C9C` | Due |

Where the names show and what staff can do:
- **Orders, the payment status column** in every layout, with the amount under it.
- **Payment status filter** (tick one or more): Paid · Due · Part paid · Pending · Payment failed · Refunded · Partial
  refund · Complimentary · Awaiting payout · **Unpaid by platform** (was "Not paid by platform"). The pill names the
  first ticked, "+1" for more.
- **Tapping Due** in the totals ticks Due and Part paid (with Pending and Payment failed) and lists exactly the orders
  behind the Due number; the pill reads just **"Due"** (not "Due +1"), because the Due total is all of them.
- **Sort › Payment status:** **"Due first"** (was "Not paid first"): Pending, Payment failed, Due, Part paid, Awaiting,
  Unpaid by platform, Paid, Complimentary, Partial refund, Refunded; or "Paid first", the other way.
- **Deleting** (long-press an order): only Due orders that aren't a delivery app's. Other rows say why they can't be
  picked ("Part paid", "Paid", "Pending", "Payment failed", "Swiggy · cancel on Swiggy"). The summary: "Due · 3 orders ₹2,345"; the pop-up's line:
  "#1031 · #1027 · ₹3,759 due".
- **The Counter** shows a payment word in one place: the pager question ("Pager 7 is still with #1031 · ‹customer› · **Due** ·
  In kitchen", above), Due orange, Part paid red, Paid black (Midnight: `#FFA066`, `#FF9C9C`, `#F1F4FA`), in all three
  menu display styles (Category grid, Pills on top, Vertical rail) and every theme. (The Counter's own Orders list,
  shown only when the Orders app isn't there, uses the same words and colours.)
- **For the dev chat:** rename "Not paid" to **Due** and "Partially paid" to **Part paid** in the Pager / Buzz / Text
  workflow document too. The Pay screen (still to design) uses the new names from the start.

### Order-type icons (Icon Pack 1): one set for every app

| Meaning | Icon | Code name (order-type-icons.js) | Android (Icon Pack 1) |
| --- | --- | --- | --- |
| Dine-in, and "Dine-in + Takeaway" | fork & knife | `dineIn` | `ic_order_dine_in` |
| The table number (only) | table | `table` | `ic_table` |
| Takeaway | bag with the smile handle | `takeaway` | `ic_order_takeaway` |
| Delivery (our own riders) | motorbike | `delivery` | `ic_order_delivery` |
| Online (our website or app) | globe, outline (stroke 2 on a 24 grid) | `online` | `ic_order_online` |
| Phone call | phone handset (unchanged) | `phone` | (unchanged) |
| Swiggy, Zomato | their app marks (unchanged) | — | — |

- **Rules:** the table icon only ever stands for a table number (the Counter's "Table 6" button), never for Dine-in.
  Online never uses the Takeaway bag. Gone everywhere: the round table, the second Takeaway bag Orders used, the
  scooter and the old Online phone (Icon Pack 1, `04_do-not-use`).
- **The Counter:** the icon is plain, in its label's colour, with no tint or tile: the order-type button, the order-type
  picker, Modify's type groups and "Serve as" buttons, and Track history's "Order opened" (a Dine-in order showed the
  table there; now the fork & knife). The same in all three menu display styles, in Light and Midnight.
- **Orders:** a tile in the type's colour, in every layout's list, Split's order header and the Order type filter:

  | Type | Light icon / tile | Midnight icon / tile |
  | --- | --- | --- |
  | Dine-in | `#9A6B1F` / `#9A6B1F1A` | `#B49A6E` / `#18223A` |
  | Takeaway | `#2E7D4F` / `#2E7D4F1A` | `#7FAA92` / `#18223A` |
  | Delivery | `#6D4BC4` / `#6D4BC41A` | `#9890BE` / `#18223A` |
  | Phone call | `#2F5FB3` / `#2F5FB31A` | `#8396BF` / `#18223A` |
  | Online | sky blue `#0284C7` / `#0284C71A` | rose `#C98BA5` / `#18223A` |

  Online is sky blue in Light and rose in Midnight on purpose (the owner's choice): the only type whose colour changes
  between themes.
- **In code, one place:** every order type's icon is drawn only by `order-type-icons.js`
  (`window.RestroOrderTypeIcons.svg(key, className)`, `.has(key)`, `.keyOf(orderType)`); the Counter and Orders both
  take theirs from it. `python3 tools/check_order_icons.py` fails if any file draws one itself or an old icon comes
  back: run it before every publish. The Android app keeps its own single list the same way (`OrderTypeIcon.kt` in the
  pack) with a UI test that fails on any other icon.

### QR orders in Orders (K)

- **On the order** (from the cloud, once QR ordering is built): `qr: true`; a Table QR's order is Dine-in on its table
  (`type: 'dine-in'`, `table`: the table's permanent id, so renaming or renumbering a table never breaks it, `guests`
  and the table's `server` when known); a Takeaway QR's is `type: 'takeaway'` with `customer: { name, mobile, code }`
  and no cashier (`server: ''`). Every QR order is **paid first**: `paidAt`, and `method` `'upi'`, `'card'`,
  `'netbanking'` or `'wallet'`. Its KOT prints only once the payment is confirmed.
- **How it shows:** a small blue **QR** tag right after the order type ("Dine-in [QR]", "Takeaway [QR]") in Classic,
  Split's list and Cards, and "Dine-in · QR · 2 guests · Server: …" in Split's order header. The tag: 24 tall, rounded
  7, a 1-wide border, the QR glyph 11 and "QR" 12.5 bold; Light `#EEF4FF` with border `#C7D7F6` and text `#1E4FB8`,
  Midnight `#1B2A47`, `#34507F` and `#A9C2FF`. The same in all 12 layouts.
- **Payment:** the method it was paid with ("Paid - UPI", "Paid - Card", "Paid - Net banking", "Paid - Wallet"), never
  Due; the bill button shows **Receipt**; it counts in Total, not Due. A Takeaway QR's row shows no cashier.
- **Never Part paid** (owner, 13 Nov 2026): a paid QR order always shows the method it was paid with. A paid order
  doesn't open on the Counter: more food is a new order with its own number, and a pager goes to the new order. (The
  pack's line "If staff later add dishes at the Counter, those are unpaid, so the order becomes Part paid" is
  withdrawn.)
- **Its payment while the restaurant is offline:** QR payment Pending, below.

### The Order type filter (K)

- In this order: Dine-in · Takeaway · Online · Phone call · Delivery · Swiggy · Zomato (other partners after them as
  they are added) · **QR**. There is no "Dine-in + Takeaway" entry any more.
- Each order counts once, under its own type; **QR** counts every order placed by QR, whatever its type (so a Table
  QR order is in both Dine-in and QR). Tick one or more: an order shows when its type is ticked, or when QR is ticked
  and it was placed by QR. The footnote: "Tick one or more · QR shows every order placed by QR, Dine-in or Takeaway".
  The QR row's tile: the QR glyph in `#1E4FB8` on `#1E4FB81A` (Midnight `#A9C2FF` on `#18223A`).

### Mixed order types (K)

The first type chosen in the Counter is the order's own (`type`); Modify adds others line by line (`split: true`, each
line's `type`). Orders shows both, the order's own first: "Dine-in + Takeaway" (the others after it in the order
Dine-in, Takeaway, Online, Phone call, Delivery), with its own type's icon and colour. The Order type filter counts it
only under its own type, and the "Order ready" text follows its own type.

### Today scrolls back (H3)

- **The day picker** stays Today · Yesterday · Tomorrow plus the calendar, with Today first. There is no "All time".
- **Only Today scrolls back.** Past today's last order comes a band across the list, "**YESTERDAY** · Sun 8 Nov", then
  yesterday's orders; then "**SATURDAY** · Sat 7 Nov" and so on, a day at a time, newest day first. The search, the
  filters, the tab (All, Open, Closed) and the sort apply to every day, each day's orders in the sort chosen. A day with
  nothing to show has no band. An order taken one day for another is listed once, on the later day.
- **Picking** Yesterday, a date or a range shows only that day or range, as before.
- **Today's numbers stay today's** while the list scrolls: the totals ("**TODAY · MON 9 NOV**" over Classic's totals
  card; "**Today's orders**" on Split's and Cards' bars, "Orders" for another day or a range), the tab counts and
  Split's "41 orders". Tapping Due lists today's Due orders only, with no days before.
- **Earlier days' orders** are past: only Bill / Receipt works on them (KOT, Notify and Buzz are greyed); Split's list
  and Cards show their date.
- **No order yet today** (and nothing searched or filtered): the "No orders yet today" screen, as before, with New
  order on the Counter and See yesterday. When today's orders are only hidden by the search or filters, the matching
  orders of the days before still show.
- **The band:** Light `#F3F4F7` between two 1-wide lines `#E4E6EB`, Midnight `#0E1626` between `#22304A`; 43 high in
  Classic, 41 in Split; "YESTERDAY" 14 extra-bold, spaced .07em, then "· Sun 8 Nov" 14 semi-bold, both `#57534E` (Midnight
  `#A8B3C7` and `#7E8AA0`), lined up with the rows' first column. Cards have no band: the words alone, across the grid.
  "TODAY · MON 9 NOV" is 13 extra-bold, spaced .05em, `#57534E` (Midnight `#8A96AD`).
- **4 days on each device:** a device keeps today and the 3 days before (by the day an order was taken, or the day it
  was taken for), every order not paid yet whatever its day, and every order with a change still to send
  (`RestroSync.keepOrders`; it replaces "the latest 500 paid orders"). Older ones are only cleared from that device: the
  cloud keeps them (SYNC.md).
- **Further back** comes from the cloud, 4 days at a time, as the end of the list comes into view
  (`RestroSync.olderOrders({ from, to })`, the cloud's `GET /orders?from=&to=`: SYNC.md), kept in memory only while
  Orders is open. Offline, or before the cloud is set up, the list ends with "**Older orders need internet**" (a cloud
  with a line through it, grey). A day or range picked from before the kept days is read the same way.
- **A receipt for an older order** prints as any other: the order comes back onto the device with the print noted,
  goes up to the cloud, and is cleared again once it has.

### Readability (H2): colour and text size only, no layout or width changes

- **Light, all 6 layouts:** the FILTERS heading `#66605B`; the search boxes' hint `#78716C`; **one orange `#C2410C`**
  for Due (the totals, the payment status, the delete list) and for a late "Open · In kitchen · N min"; "Closed" green
  `#2F7A4C`; in Split, the picked order's grey lines `#57534E` (its coloured lines, late, Ready and Scheduled, keep
  their colours); the grey column headings `#625C57` (the sorted one stays dark); the "N orders · Sort" line `#625C57`.
- **Midnight, all 6 layouts:** its colours stay, with its one orange `#FFA066`.
- **Both themes:** the side rail's counts 13; **Held in the Split and Cards rail has no arrow**, like All, Open and
  Closed. (Classic's Held link in the sidebar keeps its arrow.)

### QR payment Pending (H1): the Customer paid? pop-up

Nothing new is asked of the app: the KOT prints through `printer.printKot` and the bill, receipt and refund slip
through `printer.printBill` as before. This is how the page handles a QR order whose payment hasn't reached us, and what the cloud must do once it
is back (Phase 2). Screens: `05_screens/03_Orders_Pending-QR-payment_12-layouts` (PQ1–PQ6, with and without the
pop-up, Light and Midnight), `04_Orders_Pending-flow` (OR0–OR3) and `05_Counter_Pending-popup` (CT1).

- **When an order is Pending:** a QR order reaches the restaurant before the customer pays (the cloud waits for a
  device's "got it" before the payment page opens, I1). When no payment confirmation arrives within **30 s** and this
  system can't reach the cloud, the order is **Pending**. With the internet working a slow bank never makes an order
  Pending: the cloud answers in the end. Any tablet may mark it (`orders.js` checks every 5 s and when the connection
  changes; `RestroCounter.qrMark(uid, 'pending')`); the mark is the same on all.
- **On the order** (`qr: true`), `qrPay`:

  | `qrPay` | What it means | Orders shows |
  | --- | --- | --- |
  | `'waiting'` | the customer is on the payment page | nothing: it isn't listed, counted or on the home screen, and has no KOT |
  | `'pending'` | 30 s, no confirmation, no cloud | **Pending** · "Not in kitchen yet", **Pending** and the amount, red **Confirm !** |
  | `'matching'` | staff answered **Customer paid**: `paidAt` is when the customer paid, its KOT went | **Open** · "In kitchen · N min", **Paid · matching** |
  | `'refund'` | staff answered **Cancel and refund**: no `paidAt`, no KOT | **Closed**, **Refunded** (red, as any refund; its Receipt prints the refund slip) |
  | `'failed'` | staff answered **Customer paid**, but once online the cloud found no payment: no `paidAt`, `qrFailedAt` (ms) | **Open** as its kitchen has it, **Payment failed** (red) and the amount, red **Bill !** (below) |
  | none | paid as usual, or matched once online (`method`, `paidAt`, `payRef` from the payment) | **Paid - UPI** and the rest, as any QR order |

  With it: `qrPayAt` (ms), when the customer paid ("paid today around 7:25 PM"; the order's time when missing),
  `qrChoice: { choice: 'paid' | 'refund', by, at }`, who answered and when (also in the Track history, `events`:
  `qr-paid` or `qr-refund` with `by`), and for a failed payment `qrFailSeen: { by, at }`, who first answered its pop-up
  (the Track history's `qr-fail-seen` for Not now, ✕ or Back, `qr-fail-bill` for each Print bill), for Analytics ›
  Activity › Payments and the Payments app (both to come).
- **The row, in all 12 layouts:** the order status **"Pending"** with "Not in kitchen yet" under it (Split's list: on
  one line, then a red line with the alert icon, **"Payment pending · tap Confirm !"**, as "KOT failed · tap the order
  to reprint"); the payment status **"Pending"** and the amount; **Receipt, Notify and Buzz greyed** in their places;
  the red **Confirm !** where KOT is, styled as KOT ! (the KOT icon). Split's header ends "· Not in kitchen yet". Pending
  is in **Due's orange**, the one Due and late orders use (owner, 13 Nov 2026), in both columns: Light `#C2410C`,
  Midnight `#FFA066` (the designs' amber is not used). "Not in kitchen yet" is the grey of the line under any status.
  **Paid · matching:** "Paid" as any payment status, then "· matching" in the same orange, 600, 16 beside Classic's 19
  (the same share of the line in Split and Cards: 0.842 em).
- **Counts:** in **Due**, not in Total ("Due · 7 orders ₹9,532"); tapping Due lists it (Due, Part paid, Pending and
  Payment failed together, the pill reading "Due"); **Pending** in the All payments filter, after Part paid, and
  **Payment failed** after it; **Due first** puts Pending first, then Payment failed; it is in the Open tab. Confirmed,
  it moves to Total (Total ₹41,238, "Due · 6 orders ₹8,272"); cancelled and refunded, it is in neither; a payment that
  failed is back in Due.
- **The pop-up "Customer paid?"** opens from tapping the order (Classic, Cards) or its **Confirm !** (every layout); in
  Split tapping the order picks it as any order, and **Open** opens the pop-up. It sits 122 under the status bar (170 on
  the screen), centred, 700 wide, `#F3F4F7` rounded 34, over the usual dim (`rgba(15,23,42,.30)`; Midnight
  `rgba(0,0,0,.58)`):
  - the head: a 52 tile rounded 16, `#FFF4E0`, with an orange "?" (26, 800, `#C2410C`); 14 from it **"Customer
    paid?"** (26, 800) and under it "Order #1032 · Table 3 · QR · ₹1,260.00" (17, `#57534E`; a Takeaway QR's: the
    customer's name); a white ✕, 46 round, its glyph `#57534E`;
  - the orange words (16.5, 600, `#C2410C`, 24 a line; Due's orange, as the "?": one orange): "The payment hasn’t reached us yet. Check the customer’s
    payment screen and choose one:";
  - a white card (rounded 22, 20 in) with the two choices, 54 a row, a line `#EEECE9` between: "**₹1,260.00** paid
    today around **7:25 PM** · shows **Successful**" and "**Cancel and refund** · the customer gets their money back"
    (19; the parts in bold 700), each with a 26 box (rounded 8, a 2 border `#A8A29E`; ticked `#1E4FB8` with a white
    tick). Tick one; ticking the other moves the tick; tapping the ticked one again unticks it. (Another day: "paid
    yesterday around", "paid on Sun 8 Nov around".)
  - the grey note (15, `#57534E`): "We match the payment as soon as the internet is back. A cancelled order is refunded
    once we’re online.";
  - the buttons, 64 tall, rounded 20, 19: **Not now** (250 wide, white) and the action filling the rest: **Choose
    one**, greyed (`#E7E5E4`, `#A8A29E`), doing nothing until a choice is ticked; **Customer paid · print KOT** (blue
    `#1E4FB8`, 800); **Cancel and refund** (red `#D92D20`, 800).
  - Midnight (PQ1–PQ6 _popup_midnight): `#141E33`, the tile `#3A2A10` with `#FFA066` (the "?" and the orange words: Due's Midnight orange), the title `#F1F4FA`, the grey
    lines `#A8B3C7`, the ✕ and Not now `#22304A`, the card `#1B2742` with its line `#2A3754`, the boxes' border
    `#5B6680`, Choose one `#22304A` with `#5B6680`; ticked, and the two actions, as the other Midnight pop-ups' blue
    (`#2F6FDE`) and red (`#DC2626`).
  - **Not now**, ✕ and Back close it: the order stays Pending. A tap outside it does nothing (it waits for an answer).
  - The PIN, for staff without the access, comes with access levels.
- **Customer paid · print KOT:** the order is paid (when the customer paid), `qrPay: 'matching'`, and its KOT goes to
  the kitchen at once (its number as it prints). The bar: "**KOT sent for Order #1032** · payment will be matched when
  the internet is back" (online: just the first part). It is treated as paid: tapping it opens its receipt (its details
  page to come), Receipt and KOT work as for any paid order, and the receipt reads "PAID · QR ₹1,260" until the payment
  is matched. The kitchen printer down: the row shows **KOT !**, the badge keeps counting it, and the bar says
  "Kitchen printer offline · KOT 162 didn’t print · Order #1032" with RETRY.
- **Cancel and refund:** `qrPay: 'refund'`: Closed, **Refunded** at once (red, as any refund; owner, 13 Nov 2026: not
  "Refund pending": the customer is given the refund slip and doesn't wait), its table free. **Receipt** prints the
  refund slip, "REFUND · NOT A TAX INVOICE" with a boxed "REFUNDED ₹1,260" (Printing the bill, below); KOT, Notify and
  Buzz as for any closed order. The bar: "**Order #1032 cancelled** · refunded once we’re online". The money goes back
  when the cloud can reach the payment provider (the table below); then the row reads "Refunded - UPI" and the slip
  "REFUNDED · UPI ₹1,260".
- **The first answer wins (K):** the answer is the Counter's (`RestroCounter.qrChoice(uid, 'paid' | 'refund')`). On a
  tablet whose pop-up is open when another tablet answers, the pop-up goes and the bar says "**Already confirmed by
  ‹name›** · 7:28 pm" ("Already cancelled by …"); an answer sent after another is refused the same way. Two answers made
  at the same moment on two tablets: when their versions merge, the earlier answer stays, with what it set
  (SYNC.md, Merging).
- **The Counter (CT1):** picking Dine-in and a table that has a Pending QR order (Choose table; a table tapped on the
  Floor or on the home screen's Floor widget) shows the same pop-up first, over the Counter, the table shown picked
  behind it: "**Table 3 has a pending QR order**" · "Order #1032 · QR · ₹1,260.00 · confirm or cancel it first". The
  table is taken once a choice is made (Customer paid or Cancel and refund; the message goes in the Counter's bar);
  **Not now**, ✕ and Back put back the table there was. A Pending order never opens on the Counter, is never merged into
  another table's order and can't be deleted; its table counts as in use (Floor); a waiting or cancelled one's doesn't.
- **The sound:** while any order is Pending, a sound (`RestroSound.play('alert')`) at once and every minute until
  someone answers, on every tablet (not the kitchen screen); a new Pending order sounds at once.
- **Protection:** a Pending order can't be deleted: in delete mode it is dimmed with its **"Pending"** chip, and tapping
  it says "Pending orders can’t be deleted". End Day is never blocked by it (End Day comes later).
- **When the internet is back (the cloud, Phase 2):** the cloud settles each one and the change reaches the tablets
  through sync:

  | Answered | The money | The cloud | The tablets |
  | --- | --- | --- | --- |
  | Customer paid (`'matching'`) | arrived | matches it: takes off `qrPay`, sets `method`, `paidAt`, `payRef` | "Paid - UPI" (and the rest) |
  | not yet (`'pending'`) | arrived | takes off `qrPay`, sets `method`, `paidAt`, `payRef` | the main system prints its KOT by itself, as for any QR order paid as usual; the pop-up, the badge and Confirm ! clear (an open pop-up: "Payment received for Order #1032 · its KOT goes to the kitchen") |
  | Cancel and refund (`'refund'`) | arrived | refunds it: sets `paidAt`, `method`, `refundedAt`, `refundMethod`, takes off `qrPay` | "Refunded - UPI" |
  | not yet, or Cancel and refund | never | deletes the order (a tombstone) | it disappears, with its badge count |
  | Customer paid (`'matching'`) | never | marks it failed: `qrPay: 'failed'`, `qrFailedAt`, takes off `paidAt` | **Payment failed**, in Due, red **Bill !**, the badge and the sound (below) |

  A payment made twice is refunded by itself. There is no refund timer.
- **A QR order paid with its KOT not gone yet** (the payment arrived after all, or the order came in paid as usual):
  the main system (or a tablet on its own) sends its KOT by itself, once (`RestroCounter.sendKitchen`), on its day.
- **Not built yet:** the Floor app's side (designed later), the Payments app, Analytics › Activity, the PIN.

### Payment failed: a QR payment staff confirmed that never reached us (owner, 13 Nov 2026)

The pack says only "confirmed but no money → the owner is told"; the owner set how (13 Nov 2026). Rare: what staff saw
wasn't a real, finished payment for this order (a fake payment app or an edited screenshot, an old "Successful"
screen, or a payment still processing that then failed and went back to the customer). The food has gone out; the
money is due again. There is no design: it is built from the Pending pieces.

- **The row, in all 12 layouts:** the order status as its kitchen has it ("Open · In kitchen · N min", "Ready"); the
  payment status **"Payment failed"** in red (as Part paid and Refunded: Light `#D92D20`, Midnight `#FF9C9C`) and the
  amount; where Bill is, a red **Bill !** styled as KOT ! (Light `#FDECEC` with `#B42318`; Midnight `#4A1414` with
  `#FFB0B0`; the printer icon); KOT, Notify and Buzz as for any order. Split's list: a red line with the alert icon,
  **"Payment failed · tap Bill !"**. It is Bill, not Receipt: the order is unpaid again.
- **Counts:** in **Due**, not in Total, as Pending (above). It can't be deleted: in delete mode its chip reads
  **"Payment failed"** ("Payment failed orders can’t be deleted").
- **Bill !** opens the pop-up **"Payment failed for this order"**: the Customer paid? frame (700 wide, 122 under the
  status bar, the same type sizes), in red: the 52 tile `#FDECEC` with a "!" (26, 800, `#B42318`); the title (26,
  800); "Order #1032 · Table 3 · QR · ₹1,260.00" (17, `#57534E`); the ✕; then the words (16.5, 600, `#B42318`, the
  bold parts 800): "**₹1,260.00** was confirmed as paid by **‹name›** at **7:27 PM**, but the payment never reached us.
  Please ask the customer to pay again." (`qrChoice.by`, `qrChoice.at`; without a name: "was confirmed as paid at
  7:27 PM"); the buttons: **Not now** (250, white) and **Print bill** (blue `#1E4FB8`, 800). Midnight: `#141E33`, the
  tile `#4A1414` with `#FFB0B0`, the words `#FFB0B0`, Print bill `#2F6FDE`, the rest as Customer paid?'s Midnight.
  - **Not now**, ✕ and Back close it; a tap outside does nothing; it stays Payment failed, with Bill ! and the badge.
  - **Print bill** prints the bill (`printer.printBill`, `kind` `"bill"`, a tax invoice with its number, as any bill
    not paid yet).
  - Whichever is tapped (Not now, ✕, Back or Print bill) is an answer: someone has seen it
    (`RestroCounter.qrFailSeen(uid, 'later' | 'bill')`: the first answer's `qrFailSeen`; Track history `qr-fail-seen` or
    `qr-fail-bill`).
- **The sound:** `RestroSound.play('alert')` at once when an order turns Payment failed, and every minute until someone
  answers its pop-up on any tablet (Not now, ✕, Back or Print bill: owner, 13 Nov 2026, so the restaurant isn't
  disturbed once someone has seen it), on every tablet but the kitchen screen. **Bill !** and the **badge** stay until
  it is paid. (A Pending QR order's sound is unchanged: it goes on until Customer paid? is answered; Not now doesn't
  stop it.)
- **The badge:** Orders' badge counts it until it is paid.
- **Paying it:** tapping the order (Classic, Cards; Split's Open) opens it on the Counter, as any order still to pay;
  paid there (or on the Pay screen, to come), it is paid as any order and shows how it was paid: "Paid - UPI", "Paid -
  Card", "Paid - Cash" (the Counter takes cash only until the Pay screen comes). `qrPay` goes; `qr`, `qrPayAt`,
  `qrChoice`, `qrFailedAt` and `qrFailSeen` stay; its KOT doesn't go again; Bill ! and the badge go. Saved there
  without paying, it stays Payment failed. The customer paying again through the table QR comes with the customer
  pages.

### Settings (Update Pack 5, I2 and I3) and the Availability label

The pack's only two new settings (everything else has fixed defaults); there are no screens for them in the pack, so
they are built as the other Settings cards.

- **Settings › Printers › a kitchen printer › Use as backup printer** (I2): a switch on its own card under Copies per
  KOT, "When another kitchen printer stops working for 30 seconds, its KOTs print here with this printer’s own. One
  printer can be the backup.", with the note "With no backup printer, or the backup down too, they print on the first
  kitchen printer that works." One printer at most: turning it on turns it off on any other; a Bills printer never is
  one (its card greyed, as KOT language and Copies). The Printers list says "· Backup printer" after its role. Kept in
  `restro.printers.v1` as `backup: true` (shared by every tablet) and sent with every slip in `printers` (above).
  **What the app does with it:** a kitchen printer is down only after **30 s** without printing (a grace); its dishes
  then print on the backup printer, with the backup's own, and nothing says they moved; with no backup, or the backup
  down too, on the first kitchen printer that works. A KOT not confirmed as printed reprints on the backup with the
  REPRINT box. Kitchen printers only: a bill or receipt printer never takes KOTs.
- **Settings › Business details › Last order time** (I3): a card under Business hours, "For QR ordering, Swiggy,
  Zomato and your own online ordering. Orders your staff take work as usual until closing.", with five tiles: **At
  closing · 15 min before · 30 min before** (the default: the designs' "last orders 10:30 PM" for an 11:00 PM close) **·
  45 min before · 1 hour before**, and under them today's: "Today: last orders 10:30 pm · closes 11:00 pm" ("Closed
  today."). Kept in `restro.hours.v1` as `lastOrder` (minutes before closing; shared by every tablet);
  `RestroPrefs.lastOrderOn(day)` gives a business day's time in milliseconds (`null` when closed). The cloud (Phase 2)
  stops QR ordering, Swiggy, Zomato and the restaurant's own online ordering at it, until opening: from then to
  closing customers see the menu, and checkout says "QR ordering is paused. Please reach out to staff."; a customer who
  reached the payment page before it can finish paying. Staff-taken orders (dine-in, takeaway, walk-in, phone) work
  until closing. QR Studio shows it (QR Studio, below).
- **The home screen:** the app that was "Menu" reads **"Availability"** (K: renamed; its icon unchanged). The
  Availability app itself (store hours, what each channel sells, pausing a channel) comes later.

### Home-screen badges (J)

- **The look (OR0):** an amber circle `#D97706`, 40 across in the home's units (44 on the 1920 screen), with its
  number in white bold (18 home units: 20), its middle 8.5 in from the icon's top-right corner, and a 6 gap round it cut
  through the icon and its shadow, so the home background shows (any theme, any wallpaper or Mirror picture). The same
  in the dock and on the pages, wherever the app is put (`launcher.css`, `home-widgets.js`).
- **Orders' badge** counts each order showing **KOT !** (on the day's list), each **Pending QR payment** (Confirm !,
  whatever its day kept) and each **Payment failed** (Bill !, until it is paid): `RestroOrders.attention()`. Each
  clears by itself once fixed (reprinted, answered, settled by the cloud, paid); there is no "fixed" notice and no SMS
  or WhatsApp. "99+" past 99.
- **QR Studio's badge** counts each table renamed since its card was printed, each quiet QR and QR ordering paused by
  itself: `RestroQrStudio.attention()` (QR Studio, below). Each clears by itself once fixed.
- **Other apps:** Availability's badge comes with Availability; the others have none until the owner defines them.
- **The home's Orders widget:** a Pending order is listed as open, its chip **"Pending"** (`#FFEDD5`, Due's orange `#C2410C`);
  tapping it opens Orders on the day's list with its Customer paid? pop-up.

## QR Studio (Update Pack 5): `printer.printQr`, `qr.send`, `restro:qr-path`, `restro:qr-scan`

Built 13 Nov 2026 (Update Pack 5, part 6: the Light screens QS1–QS6 and QS16–QS53, with E, G, I1, I3, I4 and J), in
`qr-studio.js` and `qr-studio.css`. The QR codes are made by `vendor/qrcode-generator.js` (Kazuhiko Arase, MIT,
unchanged), error correction H, so the table's number in the middle still scans. Every method here is optional, as
noted.

### What QR Studio holds

- **The QRs:** one per table of the floor plan (Table QRs, listed by area), one **Takeaway** QR and one **Menu** QR
  (the menu only, no ordering), in `restro.qr.v1` (synced, SYNC.md): `{ id, kind: 'table' | 'takeaway' | 'menu', table,
  code, path, name, createdAt, createdBy, replacedAt, replacedBy, printedAt, printedBy, sentAt, sentBy, quietOk }`.
  - `table`: a table QR's table, Floor's permanent id. Renaming or renumbering a table never breaks its printed QR.
  - `code`: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0, O, 1, I or L, so it is easy to type).
  - `path`: `<restaurant>/<T7 | TK | MN>-<code>`. The QR holds `https://<our website>/<path>`. The domain is still to be
    decided (J), so `example.com` stands in for it.
  - `name`: the table's name as on the card printed or sent last.
  - `printedAt` / `printedBy`: Print, black and white. `sentAt` / `sentBy`: Send, the colour PDF.
  - `quietOk`: the quiet warning hidden until then (ms).
- **Replace** gives the QR a new code, so the old card stops working. **Delete** removes the QR. The cloud (Phase 2)
  keeps which codes work, from these records as they sync. Delete, Send and Test scan need the internet (greyed
  offline; Delete says "Needs internet"). Replace works offline: the new code starts working once the change reaches
  the cloud, and QR ordering is paused anyway while there is no internet. The cloud finds a table QR's table by its
  code, so the card of a renamed table keeps working; reprinting it prints the same QR with the new name.
- **The card** (the screens' preview, the print and the PDF): the restaurant's name; "Scan · Order · Pay" (Menu: "Scan
  to see our menu"); the QR, with a table's number on a rounded tile in the middle; the title ("Table 7", "Takeaway",
  "Menu"); two lines; a table card's "Need a waiter or the bill? Tap the bell on the menu"; then "QR not scanning? Type
  this link" and the link. Colours (the PDF): Table `#9A6B1F`, Takeaway `#2E7D4F`, Menu `#8E1E3C`.
- **What needs looking at** (the home badge, J: `RestroQrStudio.attention()`). Each clears by itself once fixed.
  - Each table renamed in Floor since its card was printed or sent: "Now Table 11 · reprint the card". QR Studio
    compares the names. Floor notes the change on the table as `renamed: { at, by }` for "Renamed today by ‹initials›".
  - Each quiet QR: no scan in 3 open business days, for a QR the cloud says usually gets scans (`usual`, below).
    "Card is fine · hide for 7 days" sets `quietOk`.
  - QR ordering paused by itself (not while the restaurant is closed).

### QR ordering (I1, I3)

The sidebar's card, kept in `restro.qrOrdering.v1` (synced): `{ off: { until, choice, by, at } | null, late: { by, at,
until } | null }`. The cloud (Phase 2) reads it to take or refuse QR orders; while QR ordering is not on, customers
see the menu, and checkout says "QR ordering is paused. Please reach out to staff."

| State | When | `restro.qrOrdering.v1` |
| --- | --- | --- |
| On | Within business hours, until the last order time (Settings, above) | `off: null` |
| Paused for a while | **30 min · 1 hour · 1 business day** (back on at the next opening time) | `off: { until (ms), choice: '30m' \| '1h' \| 'day', by, at }` |
| Off until turned on | **Until turned on** | `off: { until: null, choice: 'hand', by, at }` |
| Closed | Outside business hours, a weekly day off, or after the last order time | nothing: from Settings › Business details |
| Staying open late | The switch turned on while closed: on until the next opening time, then the business hours take over again | `late: { by, at, until (the next opening) }` |
| Paused by itself | No path for a QR order to reach a working kitchen printer (below). Back on once the path has worked for 10 s | nothing: each device works it out |

`RestroQrStudio.ordering()` returns `{ state: 'on' | 'paused' | 'hand' | 'closed' | 'late' | 'auto', reason }`
(`reason`: why it paused by itself, below).

### The path for QR orders: `restro:qr-path` or `RestroQrStudio.path(status)`

QR ordering pauses by itself while a QR order can't reach a kitchen printer. Only the app knows the path, so send it
at start-up and whenever any of it changes, as the event's `detail` or as the call's argument (an object or its JSON):

```
{ internet, wifiInternet, mobileVia, since, printers: [{ id, name, link, state, paper, backup, device }] }
```

- `internet`: QR orders can reach the restaurant (its Wi-Fi's internet or a handheld's mobile data).
- `wifiInternet`: the restaurant's Wi-Fi has internet. `false` with `mobileVia` set means a handheld's mobile data is
  carrying the QR orders.
- `mobileVia`: that device's name ("Handheld 1"), or `null`.
- `since`: when the path broke (ms), so the pause is timed from then. 0 when not known.
- `printers`: the kitchen printers (role Kitchen or Both).
  - `link`: `'wired'` (USB or Bluetooth to a printer device) or `'wifi'`.
  - `state`: `'ok'` or `'down'`. `paper`: `'ok'`, or `null` when not known.
  - `backup`: `true` for the backup printer (Settings › Printers, above).
  - `device`: a wired printer's printer device, `{ name, on, lastSeen (ms) }`.

It pauses when there is no internet, or no kitchen printer works (a wired one needs its printer device on). The
reason, checked in this order:

| `reason` | When | The banner: "QR ordering paused · …" |
| --- | --- | --- |
| `internet` | `internet` is false | no internet in the restaurant |
| `device` | the one kitchen printer is wired and its printer device is off | the printer device is off |
| `wired` | the one kitchen printer is wired and not connected | kitchen printer not connected |
| `wifi` | the one kitchen printer is on Wi-Fi and can't be reached | kitchen printer not reachable |
| `printers` | several kitchen printers and none works | no kitchen printer is working |

It turns back on by itself once the path has worked for 10 s. **See devices** shows the path, from the internet
through each printer device to each kitchen printer. The cloud (Phase 2) must pause the restaurant's QR ordering in
the same way for customers: when it can't reach the restaurant, and when the restaurant reports no kitchen printer
working.

Without the app, a device knows only its own internet. It counts the internet gone after 30 s without it (not while
it starts up, not for a blip) and takes the kitchen printers as working. Send `null` to go back to that.

**The bar's pill while QR Studio is open:** "No internet" when `internet` is false; amber "No internet · orders via
Handheld 1" when `wifiInternet` is false and `mobileVia` is set. Otherwise "Online" or "Offline", as everywhere.

### Scans: `restro:qr-scan` or `RestroQrStudio.scanned(scan)`

Dispatch every scan of the restaurant's QRs that the cloud reports, on every tablet: `{ code, at, today, usual }`.
- `code`: the QR's code. `at`: when (ms).
- `today`: the QR's scans so far this business day. Optional; without it the page counts the scans it receives.
- `usual`: how many scans the QR usually gets on an open day. 0 or left out until the cloud has a normal history; quiet
  warnings come only for a QR with `usual` above 0.

Each device keeps the latest per code in `restro.qrScans.v1` (not synced: each tablet gets them from the cloud).
**Test scan** waits 1 minute for a scan of that QR's code (from 2 s before the button was tapped) and shows "Table 7
QR works" when one comes, "Didn’t get a scan" when none does. A scan clears a quiet warning by itself.

### Printing a card: `RESTRODevice.printer.printQr({ cards })`

Print, Print all, Reprint and the toast's Print now print the cards on this device's **bill printer** (role Bills or
Both), black only, one card after another, cut between them. Return `true` (or nothing) once printed; `false`, or
throwing, keeps them not printed and says "Table 7 didn’t print · check the receipt printer". Without it the browser's
printing opens, one 72 mm card a page.

Each card is `{ kind, restaurant, heading, qr, mark, title, lines, note, linkLabel, link, url }`, printed in this order:
- `restaurant`: the restaurant's name, large and bold.
- `heading`: "Scan · Order · Pay", or "Scan to see our menu".
- `qr`: `{ size, rows, tile }`.
  - `size`: modules a side.
  - `rows`: `size` strings of `'1'` (black) and `'0'` (white), the square round the mark already cleared.
  - `tile`: `{ x, y, size }` in modules, or `null`. Fill it black with rounded corners (16% of its size) and print
    `mark` on it in white bold, centred.
  - Print the QR about 56 mm square, with white round it (the quiet zone).
- `mark`: the table's name ("7"); `null` for Takeaway and Menu.
- `title`: "Table 7", "Takeaway" or "Menu", large and bold.
- `lines`: two short lines.
- `note`: the table card's bell note, bold; `null` on the others.
- `linkLabel` ("QR not scanning? Type this link") then `link` (`example.com/<restaurant>/T7-<code>`), small, at the
  bottom.
- `kind` (`'table'`, `'takeaway'` or `'menu'`) and `url` (the full link the QR holds) are for the app.

### Sending the colour PDF: `RESTRODevice.qr.send({ to, size, language, cards })`

Send and Send all send the cards as a colour, print-ready PDF made by the cloud (Phase 2), to the business's registered
email or WhatsApp (Settings › Business details; the pop-up shows them masked). Pass it on to the cloud, which makes the
PDF and sends it with the backend's own email and WhatsApp service: no keys on the tablet.

- `to`: `'email'` or `'whatsapp'`.
- `size`: `'a6'` (Table card, A6), `'sticker'` (Sticker, 10 × 10 cm) or `'a4'` (A4 sheet, 4 per page).
- `language`: `'en'` (English), `'te'` (తెలుగు), `'hi'` (हिन्दी) or `'en+te'` (English + తెలుగు). The texts in
  `cards` are in English; the cloud prints them in the language chosen. The restaurant's name and the link stay as
  they are.
- `cards`: as for printing, above. The PDF draws them in colour, as the screens' preview does.

Return `true` (or nothing) once the cloud has it: the page marks them sent and says "Table 7 sent to email ‹masked›".
`false`, or throwing, says "Table 7 not sent · try again". Without the method: "Sending starts with the RESTRO Android
app". Download comes with the web dashboard.

## Screen lock: `restro:device-locked` and `restro:device-unlocked`

Dispatch these as window events when the tablet's power button locks the screen (`ACTION_SCREEN_OFF`) and when it is
unlocked (`ACTION_USER_PRESENT`). With staff accounts set up, locking signs the person out and the lock screen asks for
a PIN.

## The keyboard: RESTRO's own (and `restro:keyboard`)

**Nothing moves the navigation bar or the lock, the keyboard included** (owner, 12 and 13 Nov 2026; see Back, Home and
Recent apps). Both stay in view in every app, so staff can always go back or lock, even in the middle of typing.
Android draws its own keyboard over every app, and no app can draw over it or move it. So **RESTRO types with its own
keyboard** (owner, 13 Nov 2026: `keyboard.js`, `keyboard.css`). Until 12 Nov the page lifted the bar, and in the swipe
mode the lock, to sit on top of the tablet's keyboard.

- **The tablet's keyboard never opens in RESTRO.** Every field that takes typing gets `inputmode="none"` as soon as it
  is in the page: text, search, email, tel, url, number, password and boxes of several lines. What the field asked for
  is kept in `data-osk-mode`, for RESTRO's keyboard. Don't open the system keyboard from the app (no `showSoftInput`, no
  forced IME). A physical keyboard still types.
- **Where it opens:** just above the navigation bar, the full width, 430 tall (1920 × 1080 design pixels). In the swipe
  mode it reaches the bottom of the screen, with a strip 88 tall under the keys for the handle and the lock, which stay
  over it. It sits in the window on top, just under the bar.
- **The keys:**
  - Letters, with a row of numbers on top: q–p and Clear; a–l and Done; Shift, z–m, comma, full stop, Shift; ?123,
    comma, Space, full stop, and Close. An email field has @ in place of the bottom row's comma.
  - ?123: @ # ₹ _ & - + ( ) / and Clear; * " ' : ; ! ? % = and Done; ~ ` | \ < > [ ] { } ^; ABC goes to the letters.
  - A number pad for number fields (inputmode numeric, decimal or tel): 1–9, 0, Clear, Done and Close, with a point for
    decimals (amounts) and + for phone numbers.
  - The keys that do things are written, not drawn, in the owner's words (13 Nov 2026): **Done** is Enter, **Clear**
    is Backspace, **Close** puts the keyboard away.
- **Shift:** one tap for one capital, two quick taps to keep capitals on. Capitals come by themselves where the field
  asks (`autocapitalize`): a field of characters (GSTIN, the pairing code, the restaurant's name) starts in capitals; a
  field of sentences starts with one, and after a full stop.
- **Done** finishes the typing and always closes the keyboard (owner, 13 Nov 2026), on every field, a box of several
  lines too (no new lines: an address is typed on one line, with commas). The field gets Enter first (`keydown` and
  `keyup`), so its own handling still works: the Counter's search adds the dish found by its code, and a list of quick
  picks adds one. If the field doesn't handle it, a form sends itself as Enter would send it.
- **Clear** deletes the letter before the cursor; held down, it keeps deleting.
- **It goes away** with Done, with Close, with the navigation bar's Back (which only closes the keyboard, the first
  time), when the field is left, and when a key on a physical keyboard is pressed (until a
  field is tapped again). A tap anywhere outside the keyboard puts it away too (owner, 13 Nov 2026), and the tap
  still does what it does (a dish tapped on the Counter is added). Except: a tap on the field being typed in or its own
  box (its ✕ clears it, and the typing goes on), a tap on another field (the typing goes there), and the navigation
  bar (its Back puts the keyboard away first, as before). A finger that moves (scrolling a list) is not a tap.
- **The field stays in view:** where the keyboard would cover it, the list it is in scrolls it up, with room added under
  the list while the keyboard is up. The Counter's pop-ups go to the top while typing, as before.
- **Look:** Light: #E9ECEF behind, white keys, #CDD2D8 for the keys that do things, Enter in RESTRO blue #2F6FDE.
  Midnight (while the Counter or Orders is open in it): #121B2D behind, #1E2A42 keys, Enter #5B8EF0. Touch sounds play
  on the keys as on any button.
- On a computer (no touch screen), RESTRO's keyboard doesn't show, and the computer's own keyboard types.

No keyboard may resize the page: keep the page full height, and don't let a keyboard resize the WebView. A page that a
keyboard makes shorter would end at the keyboard, with the navigation bar on top of it. Every size on the screen would
also shrink, because the design's unit (`--fu`) follows the page's height.

If the tablet's keyboard ever opens all the same (it shouldn't), the RESTRO Android app can tell the page how much it
covers, whenever that changes. Take it from `WindowInsetsCompat.Type.ime()` (its bottom inset, in CSS pixels: device
pixels ÷ the WebView's density):

```js
window.dispatchEvent(new CustomEvent('restro:keyboard', { detail: { height: 386 } })); // CSS pixels; 0 when it goes down
```

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
| `kind` | `"bill"` (not paid yet) or `"receipt"` (paid: a document of its own, not a reprint of the bill); or `"refund"`, a QR order cancelled and refunded (below) |
| `title` | `"TAX INVOICE"` or `"TAX INVOICE · RECEIPT"`, printed where TAX INVOICE is; or `"BILL · NOT A TAX INVOICE"` (below); or `"REFUND · NOT A TAX INVOICE"` |
| `at` | the bill's first print (a receipt keeps the bill's date and time when a bill was printed first, otherwise its own first print); a reprint keeps it |
| `reprint` | `null` on a first print; on every later print of the same bill or receipt `{ at, by }`: a bold black outlined box at the very top, **REPRINT** in large letters, and under it `"Reprinted 7 Nov 2026 12:20 PM · by RK"` (`by`: the staff's initials) |
| `paid` | receipts only: `{ method, amount, at, ref }`, a boxed line above the footer, `"PAID · UPI ₹837"` and under it `"7 Nov 2026 12:41 PM · Ref 4318 9920 1187"` (`method`: `"Cash"`, `"UPI"`, `"Card"`, `"Net banking"`, `"Wallet"`, `"Swiggy"` or `"Zomato"`, or `"QR"` for a QR order staff saw paid and not matched yet; `ref` only when the payment has one) |
| `refunded` | refund slips only: `{ method, amount, at }`, the same boxed line where PAID goes, `"REFUNDED ₹1,260"` and under it `"9 Nov 2026 7:28 PM · Order cancelled"` (`at`: when staff cancelled it); `method` is `""` until the cloud has refunded it, then `"UPI"` and the rest: `"REFUNDED · UPI ₹1,260"` |

Each print is kept on the order (`bills`, `receipts`, `refundSlips`: `{ at, by, total }`), so the next one is a REPRINT
on every tablet.

**The refund slip** (owner, 13 Nov 2026): a QR order staff answered **Cancel and refund** for (QR payment Pending,
above) shows **Refunded**, and its Receipt button prints a slip for the customer to take: `kind`
`"refund"`, `title` `"REFUND · NOT A TAX INVOICE"` (nothing was sold), `bill` `null` (it takes no bill number), the
dishes and the sums as on any bill, then the `refunded` box. The refund itself goes once the cloud can reach the
payment provider; the customer doesn't wait for it.

**Bill number "At payment"** (Update Pack 4, Settings › Business details › Bill number; `restro.billNumber.v1`). The
owner chooses when a bill gets its number: **When the bill is first printed** (the default, as above) or **At
payment**. At payment, a bill printed before the payment comes with `title` `"BILL · NOT A TAX INVOICE"` and `bill`
`null`: print it as any bill, with that title where TAX INVOICE is and `Order #07` alone where `Bill #B-45 · Order #07`
is. The order gets its number when it is paid, and the page then sends the receipt (`kind` `"receipt"`, `title` `"TAX
INVOICE · RECEIPT"`, its `bill`) to `printBill` by itself, straight after the payment; if it returns `false` the
Counter shows "Receipt not printed" with RETRY. A pre-payment bill's prints are kept among `bills` as `{ at, by, total,
tax: false }` and count for its own REPRINT box only: the first tax invoice of the same order prints plain. A bill that
already has its number keeps it when the setting changes, and prints as the tax invoice.

## The kitchen printer: `RESTRODevice.printer.printKot(slip)`

Counter Update 7. **Save sends the KOT, and so does Pay**; each KOT has only the dishes the kitchen doesn't have yet
(a later KOT has only what was added after the earlier ones). KOT numbers run through the business day for the whole
restaurant: the day's first KOT is #1, starting again with the order numbers when the business day ends (the minute
after closing time: Settings › Business details › Business hours). A KOT gets its number as it prints, from the restaurant's one
sequence kept by the main system or the cloud (Update Pack 4; SYNC.md › KOT numbers), so `kot` is on every KOT slip. After a KOT has gone, taking a
dish off or reducing it prints a **VOID** slip, deleting the order prints **ORDER CANCELLED** (both with the reason
staff gave), changing a dish's choices or note prints a **CHANGED** slip, and marking the order as priority prints a
short **★★ PRIORITY ★★** notice. Counter's **Reprint KOT** (the order menu) sends the order's last KOT again, as it was.
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
Every KOT of a scheduled order carries the red box **SCHEDULED · READY 10:00 PM** (in `boxes`, below), and its
`info` says when it printed: `"9:30 PM (scheduled)"` when it printed by itself at the kitchen time, `"7:27 PM (sent
early)"` when it went before the kitchen time (Instant KOT, or Orders' Send now). A KOT printed after the kitchen time
(dishes added later) shows only the time.

**Delivery apps** (Update Pack 4, `SL1_kot-slips-scheduled-platform`; Update Pack 5, C2). A Swiggy or Zomato order's
band is the app's name (`"SWIGGY"`, `"ZOMATO"`), never DELIVERY; the first row is the customer and the app's order number
(`"‹customer› · Swiggy #4521"`), and `info` the app's time and when it was placed: `"Pickup 7:25 PM · placed 7:11 PM"` (the
rider picks it up at 7:25) or `"Ready by 7:05 PM · placed …"` (the customer collects it). When the app cancels the
order after its KOT printed (`restro:platform-cancelled`, Orders above), the ORDER CANCELLED slip has the same first
row, `title` `"KOT #153 · Order #1029"`, `info` `"Pickup 7:25 PM · VOID ALL · 7:40 PM · By: Swiggy"`, the dishes with
minus quantities and `footer` `"Reason: Cancelled by Swiggy"`; `by` is `null`.

**The slip, top to bottom** (Update Pack 5, C1–C5; `05_screens/07_KOT-slips` SL1–SL3), on every slip:

1. **The band** (black, white letters): `band`.
2. **The boxes** (`boxes`, in this order, each as wide as the band, outlined, red on a two-colour printer): **★★ PRIORITY ★★**
   (C3: every slip of an order marked as priority, and the priority notice; it replaces Counter Update 7's single
   star), **ADD-ON +** (C4: every KOT after the order's first, the plus on the right only), **SCHEDULED · READY 10:00
   PM** (every KOT of a scheduled order), then what the slip is: **TIME CHANGED**, **ORDER CANCELLED**, **VOID** or
   **CHANGED**. None on a plain first KOT.
3. **The first row** (`first`), the largest on the slip, bold, **black** (owner, 13 Nov 2026: the designs' red isn't
   used; it is never red): who the order is for (C2): Dine-in `"Table 6"`; a delivery app's `"‹customer› · Swiggy
   #4521"`; Takeaway and Phone order `"‹customer› · Pager 18"`, with no pager the customer's phone number,
   `"‹customer› · ‹phone›"` (as 5 + 5 digits, `"9xxxx xxxxx"`, or as a delivery app sends it); own delivery the same,
   `"‹customer› · ‹phone›"`. The designs draw a
   table 31 tall and a customer 26 (on the 420-wide slip). `""` when there is nothing to show (a walk-in with no name):
   leave the row out.
4. **The second row**, bold: `title`, `"KOT #163 · Order #1033"` (C2: always KOT # · Order #; on VOID and CHANGED the KOT
   the dish was on; on ORDER CANCELLED the order's KOTs, `"KOT #141, #152 · Order #1015"`; on TIME CHANGED the KOT it
   is about, C5; the priority notice `"Order #1033"`), then on a line of its own, bold, `when` when there is one: a
   phone order's pickup, `"Pickup 8:30 PM"`, or TIME CHANGED's new time, `"Ready by 10:30 PM"`.
5. **The small plain line**: `info` (round, guests, times, server…; below).
6. The order note in its red box (`note`), then a dashed line and the dishes (`lines`), then `footer` after a dashed
   line.

On a **black-only printer** the same slip prints all in black: nothing else changes, and there is no design of its own
(owner, 13 Nov 2026: the designs say only what is red on a two-colour printer). (Whether a printer has red will be a
setting in Settings › Printers, to come.)

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
| `band` | the black band at the top: `"DINE-IN"`, `"TAKEAWAY"`, `"DELIVERY"`, `"PHONE ORDER"`, or a delivery app's name in capitals, `"SWIGGY"`, `"ZOMATO"` (Update Pack 4) (`type` is the order type: `"dine-in"`, `"takeaway"`, `"delivery"`, `"phone"`) |
| `boxes` | Update Pack 5 (C1): the boxes under the band, in order (above): `["★★ PRIORITY ★★", "ADD-ON +", "SCHEDULED · READY 10:00 PM", "TIME CHANGED"]`, any of them, or `[]` |
| `first` | Update Pack 5 (C2): the first row, black, the largest (above): `"Table 6"`, `"‹customer› · Swiggy #4521"`, `"‹customer› · Pager 18"`, `"‹customer› · ‹phone›"`; `""` for none. The customer's phone number is in full, every digit, never masked (Update Pack 4) |
| `title`, `when` | the second row, bold (above): `"KOT #3 · Order #1015"` (`kot` is the KOT's number, `null` on TIME CHANGED; `order` the ticket), then `when`, `"Pickup 1:15 PM"` or `"Ready by 10:30 PM"`, or `""` |
| `round`, `addOn` | Update Pack 5 (C4): the KOT's round, `2`, `3`…, and `true`, on every KOT after the order's first (ADD-ON +); `null` and `false` on the first |
| `info` | small: dine-in `"4 guests · 11:46 AM · Server: ‹initials›"`, a later round `"Round 2 · 4 guests · 7:40 PM · Server: ‹initials›"`; takeaway, phone and own delivery `"7:58 PM · ‹initials›"` (a pager is in the first row; with none, nothing is said of it); on VOID and CHANGED `"11:52 AM · By: ‹initials›"`; on ORDER CANCELLED `"VOID ALL · 12:05 PM · By: ‹initials›"`; on TIME CHANGED (C5) `"was 10:00 PM · KOT sent 9:30 PM · changed 9:41 PM · ‹initials›"` (the ready-by time before, when the KOT went, when it changed, who); a scheduled order's KOT `"2 guests · 9:30 PM (scheduled) · Server: RK"` or `"… 7:27 PM (sent early) …"`; a delivery app's `"Pickup 7:25 PM · placed 7:11 PM"` (above). Times are in capitals, `"9:30 PM"` (Update Pack 4) |
| `at` | when it happened, milliseconds |
| `note` | the order note, in a red box (`"ORDER NOTE: …"`), on every KOT and the priority notice; `""` for none |
| `lines` | (none on TIME CHANGED: the dishes don't change) `{ qty, name, names, mods, note }`: `qty × name` bold (minus quantities on VOID and ORDER CANCELLED: `−8 ×`), quantities right-aligned in a fixed column; then every one of `mods` on its own line, right-aligned, red (on a CHANGED slip these are the changes: `"Medium spicy → Less spicy"`, `"+ No onion"`, `"− Less oil"`, `"+ Note: …"`); the dish's `note` last, red italic, right-aligned (`"Note: …"`). `names` is the dish's names in other languages, set on the dish in Inventory (`{ te: "…" }`), or `null`. The priority notice has no lines |
| `footer` | small, at the end: `"Priority · cook this order first"`, `"No dish changes · cook as already sent"` (TIME CHANGED), `"Reason: Customer changed mind"`, or `""` (a KOT has none: no "earlier KOT" line, C4) |
| `reason`, `by` | the reason staff gave (`""` for none) and who did it (their full name, or `null`) |
| `priority` | true when the ★★ PRIORITY ★★ box is on it |
| `printers` | Settings › Printers: `[{ id, language, copies, backup }]` for the kitchen printers; `backup: true` on the backup printer only (Update Pack 5, I2: Settings, below) |
| `reprint` | KOTs reprinted from Orders (Update Pack 3): `{ at, by }` (`by`: initials), the red **REPRINT** box with the time and initials, and **(R)** after every dish (Update Pack 1); `undefined` otherwise |

- **Red** (modifiers, dish notes, the order note, the boxes, the **REPRINT** box) prints red on two-colour printers
  (red/black ribbon or two-colour thermal paper), and black on black-only printers, as everything else (above). The
  first row is always black.
- **Language:** each printer's KOT language (`"English"`, `"Telugu"`, `"Hindi"`, `"Tamil"`, `"Kannada"`,
  `"Malayalam"`, `"Marathi"`, `"Bengali"`, `"Gujarati"`). Anything but English is printed as an image (raster), as
  thermal printers have no Indic fonts; a dish's name in that language comes from `names` (keyed by the language's code:
  `te`, `hi`, `ta`, `kn`, `ml`, `mr`, `bn`, `gu`), falling back to English.
- **Copies:** `copies` (1–3) of each slip on that printer.

The page keeps every slip on its order (`kots`: `{ id, at, kind, no, lines, reason, by }`; Update Pack 4: `how`,
`"queue"` or `"early"`, on a scheduled order's KOT, and `byApp`, `"Swiggy"`, on a delivery app's cancel), with who did
it and why (no PIN asked for now: "PIN required" comes with the access levels).

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

**The navigation bar and the lock never move** (owner, 12 and 13 Nov 2026). On every screen but the lock screen, the
bar stays at the bottom and the lock in its place (on the bar, or in the swipe mode 16 from the right and 14 from the
bottom). Both stay in view over every app, every pop-up and the keyboard (see The keyboard), so staff can always go back
or lock. How the page does it: the bar sits inside the window on top, because an HTML modal dialog makes everything
outside it untappable. While that window moves or fades as a whole (an app going into its icon, Recent apps going, the
quick controls coming down), the bar waits in its own layer instead (`#system-bar-layer`, in the browser's top layer):
over everything, in its place. In the swipe mode only the lock waits there: the strip keeps the finger, and the handle
goes with the app as before. Nothing for the Android app to do here, except never opening the tablet's own keyboard
(see The keyboard: RESTRO types with its own, which opens above the bar).

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
