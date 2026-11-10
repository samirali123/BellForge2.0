// config.js
// Centralized settings for this school's calendar. Nothing schedule-specific
// belongs here; see schedules.json and colors.js for that.

module.exports = {
  // Host the calendar device is reached at. It's a bare LAN IP with a
  // self-signed certificate, only reachable on this school's network or VPN.
  // BellForge accepts that certificate for this host only.
  cyberDataHost: "10.0.30.230",

  // Full URL to this school's calendar. The calendar id (2026-27_Bells) is
  // the second path segment, and every request is built from it.
  calendarUrl: "https://10.0.30.230/calendar/2026-27_Bells",

  // Values sent with every new bell. Confirmed against a real bell's saved
  // settings on 2026-11-10: the device offers School-bell-synth.wav and
  // odeabell.wav; zone (pgroup) 0, played once, no relay action.
  audioFile: "odeabell.wav",
  pgroup: "0",
  timesToPlay: "1",
  relayAction: "relaynone",

  // Every bell is a one-off trigger at a single point in time; the calendar
  // treats the end time as end-of-day.
  endTime: "23:59",

  // How long to wait for any one request before treating it as failed. The
  // device answers one request at a time (about 15 s per create or delete).
  requestTimeoutMs: 60000,
};
