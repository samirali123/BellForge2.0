# BellForge roadmap: 2.1 and beyond

Status: Phases 1 to 4 and 6 done, Phase 5 (editing) postponed, Phase 7 (server, sign-in) later. Written 2026-11-24 against commit `a042d10`.

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

**Decided (2026-11-24): a mix of A and C.** The sparkle is hidden at the
start.

| Time | What happens |
| --- | --- |
| 0.0 s | The bell drops in, centered |
| 0.6 s | It rings: two swings from the crown, with the clapper swinging further |
| 1.4 s | A spark flies off the rim and pushes the wordmark out to the right, while the bell slides left so the logo ends up centered |
| 2.3 s | The sparkle fades in beside the bell |
| 2.8 s | Hold on the full logo |
| 3.1 s | Fade into the login screen |

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

1. **Decided: the accent color comes from the school.** Maroon is used
   because BellForge is inside O'Dea's calendar, and another school gets
   its own color. Today `#7a1f2b` is written directly into `styles.css`
   about a dozen times (the accent, both gradients, every glow). Instead:
   - Each school sets one color in `school.json` (`"accent": "#7a1f2b"`).
   - On connect, the app works out the rest from it: hover shade, glows,
     a lighter version for links in dark mode, and whether text on it
     should be white or dark, so a light school color (yellow, say) still
     passes contrast.
   - Before a school is chosen (splash, school picker), the BellForge
     brand orange is used.
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

**Done (2026-11-24), with simple accounts.** Instead of the computer's user
name alone, people pick or create a BellForge account (a name and an
optional note, no password), kept on the computer; the computer user and
computer name are recorded alongside. Changes need a person chosen. The
Activity log is under the person's name in the top bar, with date and
person filters and CSV export. Date of birth was considered as a way to
tell people apart and left out: it isn't secret, so it proves nothing, and
it would be personal data to look after. The plan as first written follows.

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

**Leaning towards C with Microsoft accounts.** How that works is below,
under "Signing in with Microsoft".

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

**Signing in with Microsoft**

1. **One-time setup:** BellForge is registered as an app in Microsoft Entra
   ID (formerly Azure AD), the system behind every Microsoft 365 school
   account. It's a "public client" registration: no secret ships inside
   the app. It only asks for the basics (`openid`, `profile`, `email`).
2. **Each school's IT approves it once.** Most school tenants don't let
   staff approve new apps themselves, so an admin clicks "Grant admin
   consent" for BellForge. After that, nobody else is asked.
3. **Signing in:** BellForge opens the normal Microsoft sign-in page in the
   computer's browser (with the school's own MFA, if it has any). Microsoft
   sends BellForge back a token saying who the person is: name, email, a
   permanent user id, and which school tenant they belong to. This uses
   Microsoft's own library for desktop apps (`@azure/msal-node`).
4. **Staying signed in:** the sign-in is kept in the Mac Keychain or the
   Windows credential store and refreshes itself, so people sign in about
   once every few months, not every launch.
5. **Who's allowed:** each `school.json` lists its Microsoft tenant, so an
   O'Dea account can only work on O'Dea's calendar. Optionally, IT creates a
   group such as "BellForge editors", and only its members can change
   bells. Adding and removing editors then happens in tools IT already
   uses, and leavers lose access when their account is closed.
6. **The server checks it too:** every changelog entry is sent with the
   Microsoft token, and the server verifies it with Microsoft before saving.
   Nobody can write an entry under someone else's name, and entries can't
   be edited or deleted afterwards.

Two sign-ins stay separate. The CyberData login is still the shared
calendar login, as now. The Microsoft sign-in only says who is using
BellForge.

**Changelog (decided): every change to bells.** Each create, delete and
edit, with who, when, which school, the date, the bells before and after,
and whether it fully succeeded. It's visible from anywhere in the app.

**Open questions**

- Should signing in be **required** to make changes, or optional?
- Should changes be limited to an IT-managed group, or open to anyone at
  the school?
- How long is history kept?
- Where should the server live? Supabase is the quickest to build on. A
  small Azure Function keeps everything with Microsoft, which a school's
  IT may prefer.
