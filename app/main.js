// main.js — Electron main process.
//
// A thin shell around engine/: school-loader.js finds the school and its
// platform engine, which talks to the calendar device directly over HTTPS.
// The only browser window is the device's own login page, shown when
// connecting (and again if the login expires); BellForge keeps the session
// it gets from that page and never sees the password.

const { app, BrowserWindow, ipcMain, dialog, nativeTheme, session } = require("electron");
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

  mainWindow = new BrowserWindow({
    width: 480,
    height: 680,
    minWidth: 420,
    minHeight: 520,
    resizable: true,
    title: "BellForge",
    ...(!app.isPackaged && fs.existsSync(DEV_ICON) ? { icon: DEV_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
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

    const closedError = new Error("The calendar login was closed before logging in.");
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

ipcMain.handle("create-events", async (event, { assignments }) => {
  if (!currentSession) return { ok: false, error: "Not connected to a school yet." };
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { ok: false, error: "Nothing to create." };
  }

  const sendProgress = (p) => event.sender.send("create-progress", p);

  try {
    const { engine } = currentSession;
    const { succeeded, totalEvents, haltedOn, missing } = await createEvents({
      schedules: currentSession.schedules,
      createEvent: (ev, date) => withLogin(() => engine.createEvent(ev, date)),
      readMonth: (y, m) => withLogin(() => engine.readMonth(y, m)),
      assignments,
      onProgress: sendProgress,
    });
    return { ok: !haltedOn && missing.length === 0, succeeded, totalEvents, haltedOn, missing };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- calendar: read and delete bells ---------------------------------------
// One calendar action at a time. The renderer can only delete bells it was
// shown: each
// delete request is checked against the bells from the latest read of that
// month, so a stale screen or a bad message can't delete an arbitrary id.

let calendarBusy = false;
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

async function withCalendar(fn) {
  if (!currentSession) return { ok: false, error: "Not connected to a school yet." };
  if (calendarBusy) return { ok: false, error: "Still working on the last calendar action." };
  calendarBusy = true;
  try {
    return await fn();
  } catch (err) {
    return { ok: false, error: err.message.split("\n")[0] };
  } finally {
    calendarBusy = false;
  }
}

ipcMain.handle("read-month", (event, { year, month }) =>
  withCalendar(async () => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return { ok: false, error: "That isn't a valid month." };
    }
    const data = await withLogin(() => currentSession.engine.readMonth(year, month));
    rememberMonth(data);
    return { ok: true, ...data };
  })
);

ipcMain.handle("delete-events", (event, { bells }) =>
  withCalendar(async () => {
    if (!Array.isArray(bells) || bells.length === 0) return { ok: false, error: "No bells selected." };

    const toDelete = [];
    for (const { date, id } of bells) {
      const known = knownBells.get(String(date).slice(0, 7));
      const bell = known && known.get(`${date}#${id}`);
      if (!bell) return { ok: false, error: "The bell list is out of date. Refresh the month and try again." };
      if (!bell.deletable || bell.repeating) {
        return { ok: false, error: `${bell.start} ${bell.title} can't be deleted from here.` };
      }
      toDelete.push(bell);
    }

    const onProgress = (p) => event.sender.send("delete-progress", p);
    let result;
    try {
      result = await currentSession.engine.deleteEvents(toDelete, { onProgress });
    } catch (err) {
      if (err.code !== "NOT_LOGGED_IN") throw err;
      // Logged out partway: log in again and carry on with the bells that
      // weren't deleted yet, so none is sent twice.
      const done = err.deleted || [];
      currentSession.engine.setSession(
        await showLoginWindow(currentSession.config, "Your calendar login expired. Log in again to continue.")
      );
      const rest = toDelete.filter((b) => !done.includes(b));
      result = await currentSession.engine.deleteEvents(rest, { onProgress });
      result.deleted = [...done, ...result.deleted];
    }
    for (const monthData of Object.values(result.months)) rememberMonth(monthData);

    return {
      ok: !result.failed && result.stillThere.length === 0,
      requested: toDelete.length,
      deleted: result.deleted.length - result.stillThere.length,
      failed: result.failed && { start: result.failed.event.start, title: result.failed.event.title, status: result.failed.status },
      stillThere: result.stillThere.map((b) => `${b.start} ${b.title}`),
      months: result.months,
    };
  })
);

// The month grid needs more room than the connect/schedule screens. Grows
// the window once when the calendar opens; never shrinks it.
ipcMain.handle("fit-calendar", () => {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();
  const { width: sw, height: sh } = require("electron").screen.getDisplayMatching(mainWindow.getBounds()).workArea;
  const nw = Math.min(Math.max(w, 760), sw);
  const nh = Math.min(Math.max(h, 820), sh);
  if (nw !== w || nh !== h) {
    mainWindow.setSize(nw, nh, true);
    mainWindow.center();
  }
});
