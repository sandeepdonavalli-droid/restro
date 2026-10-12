// Device status bridge. In the browser this is fed by sample data;
// on Android, replace window.RESTRODevice with the native bridge.
window.RestroBatteryPreview={state:{hasBattery:true,percentage:82,plugged:false},listeners:new Set(),set(state){this.state=state;for(const cb of this.listeners)cb(state);}};window.RESTRODevice={getBatteryStatus:()=>window.RestroBatteryPreview.state,subscribeBatteryStatus(cb){window.RestroBatteryPreview.listeners.add(cb);return()=>window.RestroBatteryPreview.listeners.delete(cb);}};
