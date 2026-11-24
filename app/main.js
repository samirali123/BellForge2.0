// main.js — Electron main process.
//
// A thin shell around engine/: school-loader.js finds the school and its
// platform engine, which talks to the calendar device directly over HTTPS.
// The only browser window is the device's own login page, shown when
// connecting (and again if the login expires); BellForge keeps the session
// it gets from that page and never sees the password.

const { app, BrowserWindow, ipcMain, dialog, nativeTheme, session, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");

// engine/ and schools/ live at the repo root, not under app/. In dev
// they're found via ../engine relative to this file; a packaged build
// copies them into resources/ instead (see app/package.json "build" ->
// extraResources), so resolve based on app.isPackaged.
function resourcePath(...parts) {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return path.join(base, ...parts);
}

const { listSchools, loadSchool } = require(resourcePath("engine", "school-loader"));
const { createEvents } = require(resourcePath("engine", "create-events"));
const { JobQueue } = require(resourcePath("engine", "job-queue"));
const { validateBlock, validateSchedule, expandBlocks } = require(resourcePath("engine", "schedule-expand"));
const { normalizeBlock, saveCustomSchedule, deleteCustomSchedule } = require(
  resourcePath("engine", "custom-schedules")
);
const { parseScheduleCsv } = require(resourcePath("engine", "schedule-csv"));

let mainWindow;

// The connected school's live session — set once by connect, read by every
// screen after that (schedule menu, event creation, calendar). There's only
// ever one active connection at a time.
let currentSession = null;

// The packaged app gets its icon from the build (app/build/, see
// package.json "build"). When running unpacked with `npm start`, Electron
// would otherwise show its own logo in the Dock and taskbar, so set it here.
const DEV_ICON = path.join(__dirname, "build", process.platform === "darwin" ? "icon-mac.png" : "icon.png");

function createWindow() {
  if (!app.isPackaged && process.platform === "darwin" && fs.existsSync(DEV_ICON)) {
    app.dock.setIcon(DEV_ICON);
  }

  // Sized for the calendar, which is the home screen. The login card sits
  // centered in it.
  const { width: sw, height: sh } = require("electron").screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1180, sw),
    height: Math.min(800, sh),
    minWidth: 720,
    minHeight: 560,
    resizable: true,
    title: "BellForge",
    // Shown once the page has drawn its first frame (the splash), not
    // before, so the window never opens blank or on a half-drawn page. The
    // background matches the splash for the moment before that.
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#2b2522" : "#fffdf9",
    ...(!app.isPackaged && fs.existsSync(DEV_ICON) ? { icon: DEV_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Jobs only live as long as BellForge does (the login is kept in memory
  // only), so quitting with work left asks first.
  mainWindow.on("close", (e) => {
    const left = queue.active.length;
    if (left === 0) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Keep BellForge open", "Quit anyway"],
      defaultId: 0,
      cancelId: 0,
      message: `${plural(left, "job")} ${left === 1 ? "hasn't" : "haven't"} finished.`,
      detail:
        "Quitting stops them. Bells already created or deleted stay that way; " +
        "the rest won't be. Open BellForge again to see where each day was left.",
    });
    if (choice === 0) e.preventDefault();
  });
}

// --- appearance -----------------------------------------------------------
// "system" follows the OS; "light"/"dark" override it. Setting
// nativeTheme.themeSource is what drives the renderer's
// prefers-color-scheme, so the CSS needs no theme logic of its own.
const THEMES = ["system", "light", "dark"];

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + "\n");
}

ipcMain.handle("get-theme", () => nativeTheme.themeSource);

// The school last logged in to, so its login opens straight away next time.
ipcMain.handle("get-last-school", () => readSettings().lastSchool || null);
ipcMain.handle("forget-last-school", () => {
  try {
    const { lastSchool, ...rest } = readSettings();
    writeSettings(rest);
  } catch {
    // Nothing remembered is fine.
  }
  return { ok: true };
});

ipcMain.handle("set-theme", (event, { theme }) => {
  if (!THEMES.includes(theme)) return { ok: false };
  nativeTheme.themeSource = theme;
  try {
    writeSettings({ ...readSettings(), theme });
  } catch {
    // Not being able to remember the choice shouldn't stop it applying now.
  }
  return { ok: true, theme };
});

app.whenReady().then(() => {
  const { theme } = readSettings();
  if (THEMES.includes(theme)) nativeTheme.themeSource = theme;
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- helpers -----------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForPort(host, port, retries, delayMs, timeoutMs = 800) {
  for (let i = 0; i < retries; i++) {
    if (await isPortOpen(host, port, timeoutMs)) return true;
    await sleep(delayMs);
  }
  return false;
}

// A single 2.5s check was producing false negatives — likely too tight a
// timeout for a VPN's higher latency, and no retry meant one slow beat was
// enough to wrongly report "unreachable". Retry with backoff instead.
function isSchoolReachable(config) {
  return waitForPort(config.cyberDataHost, 443, 3, 1000, 1500);
}

// --- calendar login --------------------------------------------------------
// The device's own login page, in a small window of its own. When it lands
// anywhere but /login with a session cookie, the login worked: the cookie is
// handed to the engine and the window closes. The cookie lives in memory
// only (the window's session isn't persisted), so it's gone when BellForge
// quits.

let loginWindow = null;
let loginPromise = null;

function calendarSession(config) {
  const ses = session.fromPartition("bellforge-calendar");
  // The device uses a self-signed certificate; trust it for this host only.
  ses.setCertificateVerifyProc((req, callback) => callback(req.hostname === config.cyberDataHost ? 0 : -3));
  return ses;
}

function showLoginWindow(config, reason) {
  if (loginPromise) return loginPromise;
  const origin = new URL(config.calendarUrl).origin;
  const ses = calendarSession(config);

  loginPromise = new Promise((resolve, reject) => {
    loginWindow = new BrowserWindow({
      width: 820,
      height: 720,
      parent: mainWindow,
      title: reason || "Log in to the bell calendar",
      autoHideMenuBar: true,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    loginWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    loginWindow.on("page-title-updated", (e) => e.preventDefault());

    let done = false;
    const finish = (err, cookie) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
      loginWindow = null;
      loginPromise = null;
      err ? reject(err) : resolve(cookie);
    };

    const timer = setInterval(async () => {
      if (!loginWindow || loginWindow.isDestroyed()) return;
      let url;
      try {
        url = new URL(loginWindow.webContents.getURL());
      } catch {
        return;
      }
      if (url.origin !== origin || url.pathname.startsWith("/login")) return;
      const cookies = await ses.cookies.get({ url: origin });
      if (cookies.some((c) => c.name === "session")) {
        finish(null, cookies.map((c) => `${c.name}=${c.value}`).join("; "));
      }
    }, 500);

    // LOGIN_CLOSED pauses the job queue: every waiting job needs the login.
    const closedError = Object.assign(new Error("The calendar login was closed before logging in."), { code: "LOGIN_CLOSED" });
    loginWindow.on("closed", () => finish(closedError));
    // Closing the window mid-load also rejects loadURL; give "closed" a
    // moment so that case reads as a closed login, not a load failure.
    loginWindow.loadURL(`${origin}/login`).catch((err) =>
      setTimeout(() => {
        if (!loginWindow || loginWindow.isDestroyed()) return finish(closedError);
        finish(new Error(`Couldn't open the calendar login page (${err.message}).`));
      }, 300)
    );
  });
  return loginPromise;
}

// Runs fn; if the calendar says the login has expired, shows the login page
// again and retries once. A request the device bounced to /login wasn't
// carried out, so retrying it is safe.
async function withLogin(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code !== "NOT_LOGGED_IN") throw err;
    const cookie = await showLoginWindow(currentSession.config, "Your calendar login expired. Log in again to continue.");
    currentSession.engine.setSession(cookie);
    return fn();
  }
}

// --- IPC handlers --------------------------------------------------------

// The accent colors go to the renderer as soon as a school is picked, so
// the app takes on the school's color before the login finishes.
const hexOrNull = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
ipcMain.handle("list-schools", () => {
  return listSchools().map((s) => ({
    id: s.id,
    name: s.name,
    accent: hexOrNull(s.accent),
    accentDark: hexOrNull(s.accentDark),
  }));
});

ipcMain.handle("check-reachable", async (event, { schoolId }) => {
  const school = listSchools().find((s) => s.id === schoolId);
  if (!school) return { reachable: false, error: "Unknown school." };
  const { config } = loadSchool(schoolId);
  const reachable = await isSchoolReachable(config);
  return { reachable, host: config.cyberDataHost };
});

ipcMain.handle("connect", async (event, { schoolId }) => {
  const sendStatus = (text) => event.sender.send("status-update", text);

  try {
    const school = listSchools().find((s) => s.id === schoolId);
    if (!school) throw new Error("Unknown school.");
    const loaded = loadSchool(schoolId);
    const { config, engine } = loaded;

    sendStatus(`Checking whether ${config.cyberDataHost} is reachable...`);
    const reachable = await isSchoolReachable(config);
    if (!reachable) {
      throw new Error(
        `Can't reach ${config.cyberDataHost}. Make sure you're on ${school.name}'s ` +
          `network or VPN, then try again.`
      );
    }

    sendStatus("Log in to the calendar in the window that opened...");
    engine.setSession(await showLoginWindow(config));

    // Prove the login works before saying we're connected.
    sendStatus("Checking the login...");
    knownBells.clear();
    const now = new Date();
    rememberMonth(await engine.readMonth(now.getFullYear(), now.getMonth() + 1));

    currentSession = {
      schoolId,
      schoolName: school.name,
      config,
      engine,
      order: loaded.order,
      schedules: loaded.schedules,
      customKeys: loaded.customKeys,
      warnings: loaded.warnings,
      // New schedules use the calendar's own color labels.
      colorKeys: loaded.pickerColors,
    };

    try {
      writeSettings({ ...readSettings(), lastSchool: schoolId });
    } catch {
      // Not remembering the school only means choosing it again next time.
    }

    sendStatus("Connected.");
    return { ok: true };
  } catch (err) {
    knownBells.clear();
    return { ok: false, error: err.message };
  }
});

function scheduleMenu() {
  const items = currentSession.order.map((key) => ({
    key,
    label: currentSession.schedules[key].label,
    eventCount: currentSession.schedules[key].events.length,
    custom: currentSession.customKeys.includes(key),
  }));
  return {
    ok: true,
    schoolName: currentSession.schoolName,
    items,
    colors: currentSession.colorKeys,
    warnings: currentSession.warnings,
  };
}

ipcMain.handle("get-schedule-menu", () => {
  if (!currentSession) return { ok: false, error: "Not connected to a school yet." };
  return scheduleMenu();
});

// --- schedule builder ------------------------------------------------------
// All validation and expansion happens here in the main process, through
// engine/schedule-expand.js, so the renderer never has its own copy of the
// rules that could drift from what the engine enforces.

ipcMain.handle("validate-block", (event, { block }) => {
  if (!currentSession) return { errors: [{ field: "title", message: "Not connected to a school yet." }] };
  return { errors: validateBlock(normalizeBlock(block), currentSession.colorKeys) };
});

ipcMain.handle("preview-schedule", (event, { label, blocks }) => {
  if (!currentSession) return { ok: false, errors: ["Not connected to a school yet."] };
  const clean = { label: (label || "").trim(), blocks: (blocks || []).map(normalizeBlock) };
  const errors = validateSchedule(clean, currentSession.colorKeys);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, events: expandBlocks(clean.blocks) };
});

// Fills the builder's block list from a CSV file. Never saves anything:
// the blocks go back to the builder and still have to pass Preview.
ipcMain.handle("import-schedule-csv", async () => {
  if (!currentSession) return { ok: false, errors: ["Not connected to a school yet."] };
  const pick = await dialog.showOpenDialog(mainWindow, {
    title: "Import schedule blocks",
    filters: [{ name: "CSV", extensions: ["csv"] }],
    properties: ["openFile"],
  });
  if (pick.canceled || pick.filePaths.length === 0) return { ok: false, canceled: true };

  const file = pick.filePaths[0];
  try {
    const { blocks, errors } = parseScheduleCsv(fs.readFileSync(file, "utf8"), currentSession.colorKeys);
    return { ok: errors.length === 0, blocks, errors, fileName: path.basename(file, path.extname(file)) };
  } catch (err) {
    return { ok: false, errors: [`Couldn't read ${path.basename(file)}: ${err.message}`] };
  }
});

// Saves a copy of this school's pre-filled CSV template wherever the user
// picks, so they have something to fill out instead of guessing columns.
ipcMain.handle("save-csv-template", async () => {
  if (!currentSession) return { ok: false, error: "Not connected to a school yet." };
  const template = resourcePath("schools", currentSession.schoolId, "schedule-import-template.csv");
  if (!fs.existsSync(template)) return { ok: false, error: "This school doesn't have a CSV template yet." };

  const pick = await dialog.showSaveDialog(mainWindow, {
    title: "Save CSV template",
    defaultPath: path.join(app.getPath("documents"), "schedule-import-template.csv"),
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (pick.canceled || !pick.filePath) return { ok: false, canceled: true };
  try {
    fs.copyFileSync(template, pick.filePath);
    return { ok: true, filePath: pick.filePath };
  } catch (err) {
    return { ok: false, error: `Couldn't save the template: ${err.message}` };
  }
});

ipcMain.handle("save-schedule", (event, { label, blocks }) => {
  if (!currentSession) return { ok: false, errors: ["Not connected to a school yet."] };
  try {
    const result = saveCustomSchedule(
      currentSession.schoolId,
      { label, blocks },
      { takenKeys: Object.keys(currentSession.schedules), colorKeys: currentSession.colorKeys }
    );
    if (!result.ok) return result;
    reloadSchedules();
    return { ok: true, key: result.key, menu: scheduleMenu() };
  } catch (err) {
    return { ok: false, errors: [`Couldn't save: ${err.message}`] };
  }
});

// Deletes one schedule added through the builder. Built-in schedules can't
// be deleted (deleteCustomSchedule only looks in custom-schedules.json).
// This only removes the schedule type from BellForge; it never touches
// events already created in CyberData.
ipcMain.handle("delete-schedule", (event, { key }) => {
  if (!currentSession) return { ok: false, error: "Not connected to a school yet." };
  if (!currentSession.customKeys.includes(key)) {
    return { ok: false, error: "Only schedules you added can be deleted." };
  }
  try {
    const result = deleteCustomSchedule(currentSession.schoolId, key);
    if (!result.ok) return result;
    reloadSchedules();
    return { ok: true, label: result.label, menu: scheduleMenu() };
  } catch (err) {
    return { ok: false, error: `Couldn't delete: ${err.message}` };
  }
});

// Re-reads schedules through exactly the same load path the next app launch
// uses. Only schedule data is swapped in; the calendar login is kept.
function reloadSchedules() {
  const reloaded = loadSchool(currentSession.schoolId);
  currentSession.order = reloaded.order;
  currentSession.schedules = reloaded.schedules;
  currentSession.customKeys = reloaded.customKeys;
  currentSession.warnings = reloaded.warnings;
}

// --- calendar: read bells ----------------------------------------------------
// The renderer can only delete bells it was shown: each delete is checked
// against the bells from the latest read of that month, so a stale screen
// or a bad message can't delete an arbitrary id.

const knownBells = new Map(); // "YYYY-MM" -> Map("date#id" -> bell)

function rememberMonth(monthData) {
  const key = `${monthData.year}-${String(monthData.month).padStart(2, "0")}`;
  const bells = new Map();
  for (const day of monthData.days) {
    if (!day.inMonth) continue;
    for (const ev of day.events) bells.set(`${day.date}#${ev.id}`, { ...ev, date: day.date });
  }
  knownBells.set(key, bells);
}

// Reads aren't queued behind jobs: the engine serves them first, between
// two of a job's requests.
ipcMain.handle("read-month", async (event, { year, month }) => {
  if (!currentSession) return { ok: false, error: "Not connected to a school yet." };
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: "That isn't a valid month." };
  }
  try {
    const data = await withLogin(() => currentSession.engine.readMonth(year, month));
    rememberMonth(data);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.message.split("\n")[0] };
  }
});

// --- job queue: creating and deleting in the background ------------------------
// Creates and deletes are jobs (engine/job-queue.js), run one at a time while
// the person keeps working. The screen gets the whole queue on every change.

const queue = new JobQueue();
queue.on("update", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("jobs-update", queue.snapshot());
});
queue.on("finished", (job) => {
  // The in-app notice covers it when BellForge is in front.
  if (!Notification.isSupported() || !mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return;
  const n = new Notification({
    title: job.result.ok ? `Done: ${job.label}` : `Stopped: ${job.label}`,
    body: job.result.summary,
  });
  n.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  n.show();
});

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-11-24" -> "Tue, Nov 24"
function shortDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${DAY_NAMES[new Date(y, m - 1, d).getDay()]}, ${MONTH_NAMES[m - 1]} ${d}`;
}
const onDays = (dates) => (dates.length === 1 ? `on ${shortDate(dates[0])}` : `on ${plural(dates.length, "day")}`);

ipcMain.handle("get-jobs", () => queue.snapshot());
ipcMain.handle("cancel-job", (event, { id }) => ({ ok: queue.cancel(id) }));
ipcMain.handle("resume-jobs", () => {
  queue.resume();
  return { ok: true };
});
ipcMain.handle("clear-finished-jobs", () => {
  queue.clearFinished();
  return { ok: true };
});

ipcMain.handle("queue-create", (event, { assignments }) => {
  if (!currentSession) return { ok: false, error: "Not connected to a school yet." };
  if (!Array.isArray(assignments) || assignments.length === 0) return { ok: false, error: "Nothing to create." };
  for (const a of assignments) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) || !currentSession.schedules[a.scheduleKey]) {
      return { ok: false, error: "That schedule or date isn't valid any more. Choose them again." };
    }
  }

  // The job keeps its own copy of the schedules, so editing or deleting a
  // schedule type while it waits doesn't change what it creates.
  const schedules = {};
  for (const { scheduleKey } of assignments) schedules[scheduleKey] = currentSession.schedules[scheduleKey];
  const total = assignments.reduce((sum, a) => sum + schedules[a.scheduleKey].events.length, 0);
  const dates = assignments.map((a) => a.date);
  const labels = [...new Set(assignments.map((a) => schedules[a.scheduleKey].label))];
  const label = `${labels.length === 1 ? labels[0] : "Bells"} ${onDays(dates)}`;
  const { engine } = currentSession;

  const job = queue.add({
    kind: "create",
    label,
    dates,
    total,
    meta: { assignments: assignments.map(({ date, scheduleKey }) => ({ date, scheduleKey, label: schedules[scheduleKey].label, count: schedules[scheduleKey].events.length })) },
    run: async (job, report) => {
      const r = await createEvents({
        schedules,
        createEvent: (ev, date) => withLogin(() => engine.createEvent(ev, date)),
        readMonth: (y, m) => withLogin(() => engine.readMonth(y, m, { lane: "job" })),
        assignments,
        onProgress: (p) => {
          if (p.type === "date-start") report({ line: `${shortDate(p.date)}: ${p.label}` });
          if (p.type === "event-start") {
            const text = `Creating ${p.overallIndex} of ${p.totalEvents}: ${p.event.start} ${p.event.title}`;
            report({ text, line: text });
          }
          if (p.type === "event-ok") report({ done: p.overallIndex });
          if (p.type === "event-fail") report({ line: `Failed: ${p.error}` });
          if (p.type === "verify") report({ text: "Checking the calendar", line: "Checking the calendar..." });
        },
      });
      const where = onDays(dates);
      if (r.haltedOn) {
        return {
          ok: false,
          code: r.haltCode,
          summary: `Stopped at ${r.haltedOn}. Created ${r.succeeded} of ${r.totalEvents} bells ${where}.`,
        };
      }
      if (r.verifyError) {
        return {
          ok: false,
          code: r.verifyError.code,
          summary: `Created ${plural(r.succeeded, "bell")} ${where}, but couldn't check the calendar afterward (${r.verifyError.message})`,
        };
      }
      if (r.missing.length > 0) {
        return {
          ok: false,
          summary: `Created ${plural(r.succeeded, "bell")} ${where}, but ${plural(r.missing.length, "bell")} didn't show on the calendar afterward: ${r.missing.join(", ")}.`,
        };
      }
      return { ok: true, summary: `Created ${plural(r.totalEvents, "bell")} ${where}.` };
    },
  });
  return { ok: true, jobId: job.id };
});

// Bells waiting in (or being sent by) a delete job, as "date#id".
function bellsBeingDeleted() {
  return new Set(
    queue.active.filter((j) => j.kind === "delete").flatMap((j) => j.meta.bells.map((b) => `${b.date}#${b.id}`))
  );
}

ipcMain.handle("queue-delete", (event, { bells }) => {
  if (!currentSession) return { ok: false, error: "Not connected to a school yet." };
  if (!Array.isArray(bells) || bells.length === 0) return { ok: false, error: "No bells selected." };

  // Checked now, when it's added, against what the screen was showing.
  const pending = bellsBeingDeleted();
  const toDelete = [];
  for (const { date, id } of bells) {
    const known = knownBells.get(String(date).slice(0, 7));
    const bell = known && known.get(`${date}#${id}`);
    if (!bell) return { ok: false, error: "The bell list is out of date. Refresh the month and try again." };
    if (!bell.deletable || bell.repeating) {
      return { ok: false, error: `${bell.start} ${bell.title} can't be deleted from here.` };
    }
    if (pending.has(`${date}#${id}`)) return { ok: false, error: `${bell.start} ${bell.title} is already waiting to be deleted.` };
    toDelete.push(bell);
  }

  const n = toDelete.length;
  const dates = toDelete.map((b) => b.date);
  const where = [...new Set(dates)].length === 1 ? `from ${shortDate(dates[0])}` : `from ${plural(new Set(dates).size, "day")}`;
  const { engine, config } = currentSession;

  const job = queue.add({
    kind: "delete",
    label: `Delete ${plural(n, "bell")} ${where}`,
    dates,
    total: n,
    meta: { bells: toDelete.map(({ date, id, start, title }) => ({ date, id, start, title })) },
    run: async (job, report) => {
      const onProgress = (p) => {
        if (p.type === "start") {
          const text = `Deleting ${p.index} of ${p.total}: ${p.event.start} ${p.event.title}`;
          report({ done: p.index - 1, text, line: text });
        }
        if (p.type === "ok") report({ done: p.index });
        if (p.type === "fail") report({ line: `Failed: the calendar answered ${p.status}` });
        if (p.type === "verify") report({ text: "Checking the calendar", line: "Checking the calendar..." });
      };

      let result;
      let done = [];
      try {
        try {
          result = await engine.deleteEvents(toDelete, { onProgress });
        } catch (err) {
          if (err.code !== "NOT_LOGGED_IN") throw err;
          // Logged out partway: log in again and carry on with the bells that
          // weren't deleted yet, so none is sent twice.
          done = err.deleted || [];
          engine.setSession(await showLoginWindow(config, "Your calendar login expired. Log in again to continue."));
          const rest = toDelete.filter((b) => !done.includes(b));
          result = await engine.deleteEvents(rest, { onProgress });
          result.deleted = [...done, ...result.deleted];
        }
      } catch (err) {
        const sent = (err.deleted || []).length + done.length;
        return {
          ok: false,
          code: err.code,
          summary: `Stopped after deleting ${sent} of ${n} bells ${where}. ${err.message}`,
        };
      }
      for (const monthData of Object.values(result.months)) rememberMonth(monthData);

      const deleted = result.deleted.length - result.stillThere.length;
      if (result.failed) {
        return {
          ok: false,
          summary:
            `Stopped after deleting ${deleted} of ${n} bells ${where}. ` +
            `${result.failed.event.start} ${result.failed.event.title} wasn't deleted (the calendar answered ${result.failed.status}).`,
        };
      }
      if (result.stillThere.length > 0) {
        return {
          ok: false,
          summary: `These still show on the calendar: ${result.stillThere.map((b) => `${b.start} ${b.title}`).join(", ")}.`,
        };
      }
      return { ok: true, summary: `Deleted ${plural(deleted, "bell")} ${where}.` };
    },
  });
  return { ok: true, jobId: job.id };
});
