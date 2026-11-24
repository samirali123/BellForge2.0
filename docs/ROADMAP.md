# BellForge roadmap: 2.1 and beyond

Status: proposal, not started. Written 2026-11-24 against commit `a042d10`.

This covers seven requests, put in the order they depend on each other:

| Phase | What | Depends on | Needs internet |
| --- | --- | --- | --- |
| 1 | Splash screen | nothing | no |
| 2 | Spacing and color audit, design tokens | nothing | no |
| 3 | Calendar-first layout | 2 | no |
| 4 | Background job queue and "done" toasts | 3 | no |
| 5 | Edit a bell | 4 | no |
| 6 | Activity log on this computer | 4 | no |
| 7 | User accounts and a shared changelog (scoping only) | 6 | yes |

Phases 1 to 3 are low risk and could ship before the deploy. Phases 4 and 5
change how BellForge talks to the device, so they get their own release
after it.

---

## Phase 1: Splash screen

Options A to D are in the splash preview artifact. Whichever is picked:

- Plays as a full-window overlay in `index.html`, not a separate window, so
  there's no second window to place or close. It runs while
  `listSchools()` loads, so it adds no wait of its own.
- About 3.5 s, then a 0.4 s fade into the first screen. A click or any key
  skips it. With Reduce Motion on, it's a 1 s fade of the still logo.
- The bell is drawn from `branding/logo/bellforge-icon.svg` (vector, so the
  ring and sparkle can animate). The wordmark is cut from the existing
  lockup PNGs. **A vector (SVG) wordmark from the designer would be better**:
  the PNG is sized for 32 px and gets soft when shown large.
- Shows on every launch. No setting to turn it off unless asked for.

## Phase 2: Spacing and color audit

Findings from reading `styles.css` (screenshots of every screen come next,
in both themes, before and after):

**Color**

1. **The app's accent is maroon (`#7a1f2b`), but the BellForge brand is
   ember orange (`#F0601A`).** The orange logo sits on top of maroon
   buttons. Maroon is O'Dea's color, and BellForge is multi-school. Proposal:
   the app's chrome uses the brand orange, and a school's own colors only
   appear on its bells. `#F0601A` with white text is only about 3:1, below
   the 4.5:1 needed for small text, so buttons use a deeper ember
   (around `#C2470D`) and the bright orange stays for the logo, focus rings
   and highlights. Needs a decision before Phase 3.
2. Literal colors outside the tokens: `#d4a72c` (network "checking" dot),
   `#fff` on buttons and the today marker, maroon `rgba(122, 31, 43, …)`
   baked into the glow shadows, and the dark-mode bell ring. All become
   tokens.
3. `--ok-bg` has no dark-mode value, so success boxes use the light one in
   dark mode.

**Spacing and shape**

4. Corner radius uses 2, 3, 4, 6, 8, 10 and 16 px with no scale. Mode
   cards, the builder form and the day panel are 10 px; every other box is
   8 px. Proposal: `--radius-sm 4`, `--radius 8`, `--radius-lg 12`,
   `--radius-card 16`.
5. Nine font sizes (10, 11, 12, 13, 14, 15, 17, 18, 22 px). Proposal: a
   six-step scale.
6. Every `<button>` gets `margin-top: 4px`, which most variants then reset
   to 0. Buttons that keep it sit 4 px lower than their neighbors. The
   margin goes; spacing comes from the parent's `gap`.
7. `.hint` and `.network-status` pull themselves up with negative margins
   to sit closer to the field above. Replaced by grouping the field and its
   hint in one container with a smaller gap.
8. Panels pad inconsistently: the builder form is 12 px, the day panel is
   16 px, the card is 32 px.
9. Fixed widths that don't come from the scale: `.cal-title` 152 px,
   `.block-time` 92 px, `.range-date` 96 px, `.bell-time` 44 px. Kept where
   they line up columns, but set in `ch` so they follow the font.
10. Smaller: `.screen[hidden]` repeats the global `[hidden]` rule;
    `#progress-pct` and `.meter-pct` are two rules for the same thing; the
    review screen says "3 day(s)" while everything else uses the `plural()`
    helper.

## Phase 3: Calendar-first layout

BellForge opens to the calendar. Everything else is reached from it.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [bell] BellForge · O'Dea   ‹ November 2026 ›  Today   [+ Add bells ▾] (◔ 2) (SA) │
├──────────────────────────────────────────────┬───────────────────────┤
│  Sun  Mon  Tue  Wed  Thu  Fri  Sat           │ Tuesday, November 24  │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐          │ ▮▮ ▮ ▮▮ ▮  timeline   │
│  │  │ │  │ │  │ │  │ │  │ │  │ │  │          │ 07:10 M0   Maroon 0   │
│  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘          │ 08:10 M1   ...        │
│   ...                                        │ [Edit] [Delete] [Apply schedule…] │
└──────────────────────────────────────────────┴───────────────────────┘
```

- **Startup:** splash, then the school and login screen (still needed: the
  calendar can't be read without a login). BellForge remembers the last
  school in `settings.json` and starts its login straight away, so most
  days it's splash, log in, calendar.
- **Top bar, always visible:** logo and school, month navigation, the
  **Add bells** menu, the jobs indicator (Phase 4) and an account menu
  (theme switch, and later account and changelog). A top bar was chosen
  over a bottom bar because it's where desktop apps keep these, it keeps
  the toasts next to the jobs indicator, and the bottom of the window is
  where the day's bell list grows.
- **Add bells menu:** Single day, Date range, New schedule type, My
  schedules. Each opens as a panel over the calendar instead of replacing
  it, and closing it goes back to the calendar.
- **Day panel moves to the right side** of a wider window (default about
  1100 by 760, up from 480 by 680), so choosing a day no longer pushes its
  bells below the fold. It gets **Apply schedule to this day**, which is
  the Single day flow with the date already filled in.
- **Several days at once:** Shift-click or Cmd/Ctrl-click days in the grid,
  then Apply schedule. That replaces most uses of the date-range table and
  is the natural way to "adjust 5 days one by one".
- The step indicator goes. It described a linear flow that no longer
  exists. Multi-step panels (builder, then preview) show their own steps.
- `fit-calendar` goes: the window opens at calendar size.

## Phase 4: Background job queue and notifications

Today every create and delete holds the screen until it finishes (about
15 s a bell, so a full day is a couple of minutes). Instead, each one
becomes a **job** in a queue owned by the main process, and the user keeps
working.

**How it works**

- `main.js` gets a `JobQueue`. A job is
  `{ id, kind: "create" | "delete" | "edit", label, steps, status, progress, result }`.
  Jobs run one at a time, in the order they were added, because the device
  only handles one request at a time.
- **Reading the calendar can't wait two minutes behind a job.** The engine
  gets one request lock with two lanes: job steps and calendar reads. A read
  goes next, between two bells, so browsing to another month waits for at
  most the one request in flight (up to about 15 s), not the whole job. The
  current `calendarBusy` flag, which refuses reads while deleting, goes.
- Each job is checked when it's **added**, not when it runs: deletes are
  still matched against the latest read of that month (`knownBells`), so
  the safety check stays the same.
- Bells with a job waiting on them are shown as pending on the calendar
  (struck through for a delete, ghosted for a create) and can't be selected
  again, so nothing is queued twice.
- **Failure:** a job still stops at its first failure and verifies against
  the calendar, as now. A failed job doesn't stop the jobs after it, except
  when the device can't be reached, which pauses the whole queue with a
  Retry button. An expired login pauses the queue, shows the login window,
  and carries on, as `withLogin` does today.
- **Quitting** with jobs left asks first ("2 jobs haven't finished. Quit
  anyway?"). Jobs don't survive a restart, because the login session lives
  in memory only.

**What the user sees**

- **Toasts, top right:** "Deleted 4 bells from Tue, Nov 24" with a link to
  that day, or "Stopped: 3 of 7 created on Dec 2" in red. A success toast
  goes away after 6 s; a failure stays until it's closed.
- **Jobs indicator** in the top bar: a ring showing overall progress and a
  count. Clicking it opens the queue: the running job with its meter, the
  waiting jobs (each can be cancelled before it starts), and the ones that
  finished.
- If the BellForge window isn't in front, a system notification as well
  (Electron `Notification`).
- The calendar re-reads the affected month when a job finishes, so the grid
  is never stale.

## Phase 5: Edit a bell

Select one bell, then **Edit**: change its title, details, time, color or
date.

**Is there an edit request?** Probably. The README notes that "the audio
choices are on any bell's edit page in the calendar", so the device has an
edit form. Its request hasn't been captured yet. Before building this:

1. On the school network, open a bell's edit page in the calendar.
2. With the browser's developer tools open on the Network tab, change the
   time and save.
3. Record the request: method, path, form fields, and the response.

That's about 10 minutes, and needs someone on the school network (this
session can't reach `10.0.30.230`).

**If the device has an edit request:** one request, the bell keeps its id,
no gap. This is the preferred path.

**If it doesn't:** create the new bell first, check it's on the calendar,
then delete the old one. Doing it in that order means a failure partway
leaves a duplicate bell, never a missing one. A missing bell is a bell that
doesn't ring.

**Either way:**

- An edit is a job in the Phase 4 queue.
- Bells made outside BellForge may use a different audio file, zone or
  repeat count from the school's defaults. The edit reads the bell's own
  edit form first and keeps those values, so editing a bell doesn't
  silently change how it sounds.
- The "later today, hasn't rung yet" warning applies to edits too.
- Repeating bells stay read-only, as now.

## Phase 6: Activity log on this computer

Before accounts exist, every job writes a line to a local, append-only log
in the user folder (`activity.jsonl`, next to `settings.json`): when, which
school, what was done, the bells before and after, and how it ended. "Who"
is the computer's own user name for now.

An **Activity** panel (from the account menu) lists it, newest first,
filterable by date. This is useful straight away, and it's the format
Phase 7 sends to a server, so none of it is thrown away.

## Phase 7: User accounts and a shared changelog (scoping)

The CyberData login is shared, so it can't tell people apart. BellForge
needs its own idea of who's signed in, and a shared log needs a server,
because each copy of BellForge only sees its own computer.

**Options for accounts**

| Option | Effort | Trust | Notes |
| --- | --- | --- | --- |
| A. Pick your name from a list on launch | days | low: anyone can pick anyone | No server, no passwords. Fine for "who was it, roughly". |
| B. BellForge's own email and password accounts | weeks | medium | We'd be storing passwords and handling resets and leavers. |
| C. **Sign in with the school's Google or Microsoft account** | 2 to 3 weeks | high | Recommended. Staff already have these accounts, IT already removes leavers, and BellForge never sees a password. |

Recommended: **C**, with a small hosted backend (Supabase or similar:
sign-in, a Postgres table, and row rules so a signed-in user can add log
entries but never change or delete them). Each school only sees its own
log.

**What it involves**

- Sign-in through the system browser (OAuth with PKCE and a loopback
  redirect), the usual way for a desktop app.
- Log entries go to the server as they happen. When offline, or on the
  school network without internet, they queue in the local log (Phase 6)
  and upload later.
- A **Changelog** panel, reachable from anywhere in the app, shows the
  school's shared history: who changed which bells, when.
- New ongoing costs: hosting (free tier likely covers one or two schools),
  a domain, and someone to own the backend.

**Open questions before this is designed in detail**

- Which account system do the schools use: Google Workspace or Microsoft
  365?
- Should signing in be **required** to make changes, or optional?
- How long is history kept?
- Does each school's IT need to approve a new app sign-in?
- Is "changelog" the history of calendar changes (assumed here), BellForge's
  own release notes, or both? Release notes are cheap: they ship inside the
  app and need no server.
