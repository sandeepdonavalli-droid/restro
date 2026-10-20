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

## Screen lock: `restro:device-locked` and `restro:device-unlocked`

Dispatch these as window events when the tablet's power button locks the screen (`ACTION_SCREEN_OFF`) and when it is
unlocked (`ACTION_USER_PRESENT`). With staff accounts set up, locking signs the person out and the lock screen asks for
a PIN.
