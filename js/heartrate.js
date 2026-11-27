// Live heart rate from the watch over Bluetooth (standard Heart Rate Service,
// which the Fenix 7 uses when "Broadcast Heart Rate" is on). Parsing and zone
// time are pure functions; the Bluetooth part lives in the app.

/** Heart Rate Measurement characteristic (0x2A37) → { bpm, contact, rr: seconds[] }. */
export function parseHeartRate(view) {
  const flags = view.getUint8(0);
  const wide = flags & 0x01;
  const bpm = wide ? view.getUint16(1, true) : view.getUint8(1);
  let offset = wide ? 3 : 2;
  const contact = flags & 0x04 ? Boolean(flags & 0x02) : null;
  if (flags & 0x08) offset += 2; // energy expended
  const rr = [];
  if (flags & 0x10) for (; offset + 1 < view.byteLength; offset += 2) rr.push(view.getUint16(offset, true) / 1024);
  return { bpm, contact, rr };
}

/** 0 = below zone 1, 1–5 = Garmin zones from their floors. */
export function zoneOf(bpm, floors = []) {
  let z = 0;
  floors.forEach((f, i) => { if (f != null && bpm >= f) z = i + 1; });
  return z;
}

/** Time spent in each zone since connecting. Gaps over 5 s (lost signal) are not counted. */
export function zoneClock() {
  const secs = [0, 0, 0, 0, 0, 0];
  let last = null;
  return {
    secs,
    add(zone, at) {
      if (last != null) {
        const dt = (at - last) / 1000;
        if (dt > 0 && dt <= 5) secs[zone] += dt;
      }
      last = at;
    },
    reset() { secs.fill(0); last = null; },
  };
}
