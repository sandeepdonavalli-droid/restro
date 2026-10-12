# RESTRO Android bridge: Wi-Fi and Bluetooth

Browsers cannot list or join Wi-Fi networks, and they show Bluetooth devices only in
their own picker. The RESTRO Android app fills that gap by defining these optional
objects on `window.RESTRODevice` before the page loads. The web screens detect them
automatically; nothing else needs to change.

## Wi-Fi: `RESTRODevice.wifi`

| Method | Returns | Android API |
| --- | --- | --- |
| `isEnabled()` | `true` / `false` | `WifiManager.isWifiEnabled()` |
| `setEnabled(on)` *(optional)* | — | Settings panel (`Settings.Panel.ACTION_WIFI`) on Android 10+ |
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
| `startScan(onDevice)` | a `stop()` function | `BluetoothLeScanner.startScan` and/or `BluetoothAdapter.startDiscovery()`; call `onDevice({ id, name, rssi })` per device |
| `connect(id)` | `true` / `false` | `BluetoothDevice.createBond()` / `connectGatt()` / RFCOMM for printers |
| `disconnect(id)` | — | `BluetoothGatt.disconnect()` / close socket |
| `getPairedDevices()` | `[{ id, name, connected }]` | `BluetoothAdapter.getBondedDevices()` |

Permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (Android 12+), `ACCESS_FINE_LOCATION` (older).

All methods may return promises. Throw an `Error` with a short message to show it to the user.
