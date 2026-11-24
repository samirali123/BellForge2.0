# BellForge 2.0

BellForge enters bell schedules into a school's CyberData (InformaCast)
calendar, shows the calendar month by month, and deletes bells, from one
desktop app for macOS and Windows.

2.0 talks to the calendar device directly, sending the same requests the
calendar's own web page sends. There's no browser to keep open and nothing
else to install: no Edge, no Playwright, no debug port. Version 1.x, which
drove a logged-in Edge window, lives on in the `projectBellForge` repo.

Multi-school: a school is a folder under `schools/` with its own bell
times, colors and device address. See "Adding a new school" below.

---

## Using it

1. Open BellForge and choose your school. BellForge checks the calendar
   device is reachable (you need to be on that school's network or VPN),
   then opens the calendar's own login page in a small window. Next time,
   BellForge remembers the school and opens its login straight away
   (**Change** next to the school's name picks another).
2. Log in there as usual. BellForge keeps the login session that page
   creates and never sees the password. If the login expires while you're
   working, the login window opens again and the task carries on.
3. The calendar opens on the current month, with today selected. From
   there:
   - Click a day to see its bells, delete them, or **Apply schedule…** to it.
   - **Add bells** (top right) has **Single day**, **Date range**, **New
     schedule type** and **My schedules**. Each opens in a panel over the
     calendar; close it (or press Esc) to go back.

Every bell is created at the school's chosen audio file, zone, and color,
then BellForge re-reads the calendar to confirm each one is really there.

## The job queue

The device handles one request at a time, about 15 seconds per bell, so
creating and deleting run in the background as **jobs**, one after another
in the order they were added. You can keep browsing months and queue more
work meanwhile; changing month waits at most for the one bell being sent.

- The **jobs button** in the top bar (it appears with the first job) shows
  overall progress. Click it for the list: what's running, what's waiting
  (each can be cancelled before it starts), and what finished.
- A **notice** in the top right says when a job is done or stopped, with a
  link to the day. If BellForge isn't the window in front, a system
  notification is shown too.
- Days with a job waiting get a dot, and bells waiting to be deleted are
  struck through and can't be picked again.
- A job that fails stops where it is and says what was and wasn't done;
  the jobs after it still run. If the calendar can't be reached or the login
  window is closed, the queue **pauses** instead, with a Resume button.
- Quitting with jobs left asks first. Jobs only exist while BellForge is
  open (the login is kept in memory only).

When a schedule is applied to a day that already has bells, the review says
so: the new bells are added alongside the old ones, not in their place.

## Calendar: viewing and deleting bells

Each day shows how many bells it has and a small timeline of them in
their calendar colors. Use the arrows to change month, **Today** to jump
back, and **Refresh** to re-read.

Click a day to see its bells on the right, with a larger timeline (and a
line at the current time when it's today). Today's bells are marked
**Rang** or **Later today**.

To put one schedule on several days, Shift-click a second day to pick every
weekday in between, or Ctrl-click (Cmd-click on Mac) to add or remove single
days, weekends included. Then **Apply schedule…**.

To delete, tick the bells (or **Select all**), then **Delete selected**. A
confirmation lists exactly what will be removed. If any of them are later
today and haven't rung yet, it warns that they won't ring today, and Delete
stays locked until you tick "I understand". The delete then goes into the
job queue. Afterward the month is re-read to check they're really gone. If
a delete fails, the job stops there and says which bells were and weren't
deleted.

Repeating bells are shown but can't be deleted from BellForge (the
calendar's delete for those may remove the whole series).

## Adding schedule types

After logging in, choose **New schedule type**. Name it, add its blocks
(title, color, start and end time, or tick "point event" for a single bell
with no end), then **Preview** to see every bell that will be created,
including the automatic Pass and Dismissal bells, before saving. Colors are
the calendar's own color buttons, listed with their hex values in
`schools/<school>/picker-colors.js`.

**My schedules** lists the types you've added and lets you delete them.
That only removes the type from BellForge; bells already on the calendar
aren't touched, and built-in schedules can't be deleted.

To fill in blocks in Excel or Google Sheets, click **Get CSV template**,
fill it in (columns `title, details, start, end, color`, one row per block,
`end` blank for a point event), save as CSV, then **Import CSV**. Times can
be `08:10`, `8:10`, or `8:10 AM`. If any row has a problem, nothing is
imported and each problem is listed by row number.

Added schedules are saved per user, outside the app, so updates never
remove them:

- macOS: `~/Library/Application Support/BellForge/schools/<school>/custom-schedules.json`
- Windows: `%APPDATA%\BellForge\schools\<school>\custom-schedules.json`

---

## Developing

You need Node.js (a current LTS) and Git.

```bash
cd app
npm install
npm start
```

The engine has no dependencies of its own. `npm test` (from the repo root)
runs the job queue and device-lock tests, with the device faked. `npm install` in `app/` also
renames the development copy of Electron to BellForge on macOS
(`tools/brand-dev-electron.js`).

## How it talks to the calendar

All of this is in `engine/platforms/cyberdata.js`, confirmed against the
live device:

| Action | Request |
| --- | --- |
| Log in | The device's own login page, in a BellForge window. BellForge keeps its `session` cookie in memory only. |
| Read a month | `GET /calendar/<calendar>?y=2026&m=11`, parsed from the page's day cells and bells |
| Create a bell | `POST /calendar/<calendar>/new_task`, a plain form (every key must be sent). Success is a redirect back to the calendar |
| Delete a bell | `DELETE /calendar/<calendar>/<y>/<m>/<d>/<id>` |

A request the device redirects to `/login` means the login expired;
BellForge shows the login window again and retries. The device uses a
self-signed certificate, which BellForge accepts for that school's device
address only.

## Project structure

```
BellForge2.0/
├── app/                      Electron app: main.js, preload.js, renderer/
├── engine/
│   ├── school-loader.js       finds schools/, loads one school and its engine
│   ├── platforms/cyberdata.js the CyberData engine (direct requests)
│   ├── create-events.js       creation loop, then checks the calendar
│   ├── schedule-expand.js     turns authored blocks into bells (adds Pass/Dismissal)
│   ├── custom-schedules.js    schedules added in BellForge (per user)
│   └── schedule-csv.js        CSV import for the builder
├── schools/
│   └── odea/
│       ├── school.json        { id, name, platform, accent, accentDark }
│       ├── schedules.json     bell times for every schedule type, plus menu order
│       ├── schedules.notes.md where those bell times came from
│       ├── schedule-import-template.csv
│       ├── colors.js          schedule color names -> calendar color labels
│       ├── picker-colors.js   calendar color labels -> hex values sent
│       └── config.js          device address, calendar URL, audio file, zone
├── tools/                    build helpers (ad hoc Mac signing, icons)
└── .github/workflows/build.yml
```

## Adding a new school

1. Copy `schools/odea/` to `schools/<new-school-id>/` and set `id` (the
   folder name) and `name` in `school.json`. Set `accent` to the school's
   color (a hex value like `"#7a1f2b"`); BellForge's buttons, links and
   highlights take it on once the school is chosen. `accentDark` is
   optional, for a brighter version in dark mode. Hover shades, and white
   or dark text on buttons, are worked out from it (`app/renderer/accent.js`)
   so every pairing stays readable.
2. In `config.js`, set the device address (`cyberDataHost`), the calendar
   URL, and the audio file. The audio choices are on any bell's edit page
   in the calendar.
3. Check `picker-colors.js` against that calendar's New Event form (each
   color button's `data-color`).
4. Write `schedules.json` with the school's real bell times. Each schedule
   is a list of blocks (`title`, `start`, `end`, `color`, `details`); leave
   out `end` for a point event. Pass and Dismissal bells are added
   automatically.
5. Test on a weekend date first, then delete the test bells from Calendar.

A school on a different bell platform needs its own
`engine/platforms/<name>.js` with the same functions.

## Releases

1. Bump `"version"` in `app/package.json`.
2. `git tag v2.0.1 && git push origin v2.0.1`
3. GitHub Actions builds the Mac and Windows installers and creates a
   **draft** release. Review it, then publish. The repo is private, so send
   clients the installers directly.

Installers are unsigned. On Windows, SmartScreen asks once ("More info",
then "Run anyway"). On Mac, the first open needs System Settings > Privacy
& Security > "Open Anyway". The Mac build is signed ad hoc by
`tools/adhoc-sign.js`, without which macOS reports a downloaded copy as
damaged. The Mac build is for Apple Silicon only.

## Known limitations

- No editing existing bells (delete and recreate instead).
- Repeating bells can't be deleted from BellForge.
- The operator picks each date's schedule type; nothing is detected
  automatically.
