# engine/

School-agnostic app code. See the top-level `README.md` for running,
setup, and the full project layout. This file is a map of this folder.

- **`school-loader.js`** — discovers folders under `../schools/` and, for a
  chosen school, loads its `schedules.json` / `colors.js` /
  `picker-colors.js` / `config.js`, picks the `platforms/*.js` engine its
  `school.json` names, and hands back a ready engine.
- **`platforms/cyberdata.js`** — the CyberData/InformaCast engine. Reads a
  month, creates bells and deletes bells by sending the same HTTP requests
  the calendar's own page sends, using a login session the app gets from
  the device's login page. Throws a `NotLoggedInError` when the session
  has expired so the app can ask for a new login and retry. Contains no
  school's data itself.
- **`job-queue.js`** — runs creates and deletes one at a time in the
  background, in order; pauses when the device can't be reached or the
  login is abandoned. Tested in `test/job-queue.test.js` (`npm test`).
- **`accounts.js`** — the people who use BellForge on this computer (a
  name and an optional note; no password), in `accounts.json`.
- **`activity-log.js`** — the append-only record of every change
  (`activity.jsonl`, one JSON entry per line), with filtering and CSV
  export. Tested in `test/activity.test.js`.
- **`create-events.js`** — the creation loop: creates every bell for a list
  of dates, halts on the first failure, then re-reads the calendar to
  confirm each created bell is there.
- **`schedule-expand.js`** — turns a schedule's authored blocks into bells,
  adding the Pass and Dismissal bells, and validates blocks.
- **`custom-schedules.js`** — saves and loads schedule types added in
  BellForge, per user, outside the app so updates don't remove them.
- **`schedule-csv.js`** — parses a CSV of blocks for the builder's Import
  CSV.

The engine has no npm dependencies.
