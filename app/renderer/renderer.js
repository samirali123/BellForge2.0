// --- element refs -------------------------------------------------------

const schoolSelect = document.getElementById("school-select");
const networkStatus = document.getElementById("network-status");
const networkText = networkStatus.querySelector(".network-text");
const connectBtn = document.getElementById("connect-btn");
const connectError = document.getElementById("connect-error");
const connectLog = document.getElementById("connect-log");
const subtitle = document.getElementById("subtitle");

// --- state ---------------------------------------------------------------

let selectedSchoolId = null;
let schools = []; // [{ id, name, accent, accentDark }] from list-schools
let unsubscribeStatus = null;
let scheduleMenu = null; // { schoolName, items: [{key, label, eventCount}], colors, warnings }
let pendingAssignments = [];
let reviewOrigin = "screen-single";
let creating = false; // a create run is in progress; the panel can't close
let refreshAfterRun = false; // re-read the month when the panel closes after a run

// --- views -------------------------------------------------------------------
// Three layers: the login card (before connecting), the calendar (home, once
// connected), and a panel over the calendar for adding bells and managing
// schedule types. showScreen() takes any screen id and shows the right one:
// "screen-calendar" closes the panel.

const connectView = document.getElementById("connect-view");
const appView = document.getElementById("app-view");
const sheet = document.getElementById("sheet");
const sheetTitle = document.getElementById("sheet-title");
const sheetClose = document.getElementById("sheet-close");

const SHEET_TITLES = {
  "screen-single": "Apply a schedule",
  "screen-range": "Date range",
  "screen-builder": "New schedule type",
  "screen-builder-preview": "New schedule type",
  "screen-my-schedules": "My schedules",
  "screen-review": "Review",
  "screen-progress": "Creating bells",
};

function showScreen(id) {
  if (id === "screen-connect") {
    closeSheet();
    appView.hidden = true;
    connectView.hidden = false;
    document.body.classList.remove("app-mode");
    return;
  }
  if (id === "screen-calendar") {
    closeSheet();
    return;
  }
  closeAddMenu();
  const wasOpen = !sheet.hidden;
  sheet.hidden = false;
  sheet.querySelectorAll(".screen").forEach((s) => {
    s.hidden = s.id !== id;
  });
  sheetTitle.textContent = SHEET_TITLES[id] || "";
  sheetClose.hidden = creating;
  renderSteps(id);
  sheet.querySelector(".sheet-panel").scrollTop = 0;
  if (!wasOpen) sheetClose.focus();
}

function closeSheet() {
  if (creating || sheet.hidden) return;
  sheet.hidden = true;
  document.getElementById("add-btn").focus();
  // However the panel closes after a run, the calendar re-reads the month
  // so it shows the bells that were just created.
  if (refreshAfterRun && cal.year) {
    refreshAfterRun = false;
    loadMonth(cal.year, cal.month);
  }
}

sheetClose.addEventListener("click", closeSheet);

// --- step indicator ----------------------------------------------------------
// Multi-step flows in the panel show their steps, the current one
// highlighted. Single-step screens show none.

const FLOWS = {
  create: ["Dates", "Review", "Create"],
  build: ["Build", "Preview"],
};
const SCREEN_STEPS = {
  "screen-single": ["create", 0],
  "screen-range": ["create", 0],
  "screen-review": ["create", 1],
  "screen-progress": ["create", 2],
  "screen-builder": ["build", 0],
  "screen-builder-preview": ["build", 1],
};

function renderSteps(screenId) {
  const list = document.getElementById("steps");
  list.innerHTML = "";
  const entry = SCREEN_STEPS[screenId];
  if (!entry) return;
  const [flow, current] = entry;
  FLOWS[flow].forEach((label, i) => {
    const li = document.createElement("li");
    li.textContent = label;
    if (i < current) li.className = "done";
    if (i === current) {
      li.className = "current";
      li.setAttribute("aria-current", "step");
    }
    list.appendChild(li);
  });
}

// --- theme switch ------------------------------------------------------------

// There's a switch on the login card and another in the calendar's top bar.
const themeButtons = document.querySelectorAll(".theme-switch button");

function markTheme(theme) {
  themeButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.theme === theme)));
}

themeButtons.forEach((b) => {
  b.addEventListener("click", async () => {
    const result = await window.api.setTheme(b.dataset.theme);
    if (result.ok) markTheme(result.theme);
  });
});

window.api.getTheme().then(markTheme);

// --- connect screen --------------------------------------------------------

function showConnectError(message) {
  connectError.textContent = message;
  connectError.hidden = false;
}

function clearConnectError() {
  connectError.hidden = true;
  connectError.textContent = "";
}

function resetConnectLog() {
  connectLog.innerHTML = "";
  connectLog.hidden = true;
}

function appendConnectLog(text, kind) {
  connectLog.hidden = false;
  const line = document.createElement("div");
  line.className = kind ? `line ${kind}` : "line";
  line.textContent = text;
  connectLog.appendChild(line);
  connectLog.scrollTop = connectLog.scrollHeight;
}

function setNetworkStatus(state, text) {
  networkStatus.hidden = false;
  networkStatus.className = `network-status ${state}`;
  networkText.textContent = text;
}

async function loadSchools() {
  schools = await window.api.listSchools();
  schoolSelect.innerHTML = "";

  if (schools.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No schools configured";
    opt.disabled = true;
    opt.selected = true;
    schoolSelect.appendChild(opt);
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a school…";
  placeholder.disabled = true;
  placeholder.selected = true;
  schoolSelect.appendChild(placeholder);

  for (const school of schools) {
    const opt = document.createElement("option");
    opt.value = school.id;
    opt.textContent = school.name;
    schoolSelect.appendChild(opt);
  }
}

// The line under "BellForge" is just the chosen school's name: nothing
// platform-specific, since schools may run on different bell systems.
function setSubtitle(text) {
  subtitle.textContent = text || "";
  subtitle.hidden = !text;
}

async function onSchoolChange() {
  selectedSchoolId = schoolSelect.value || null;
  setSubtitle(selectedSchoolId ? schoolSelect.selectedOptions[0].textContent : "");
  window.accent.applySchoolAccent(schools.find((s) => s.id === selectedSchoolId));
  clearConnectError();
  resetConnectLog();
  connectBtn.disabled = !selectedSchoolId;

  if (!selectedSchoolId) {
    networkStatus.hidden = true;
    return;
  }

  setNetworkStatus("checking", "Checking network…");
  const schoolId = selectedSchoolId;
  const result = await window.api.checkReachable(schoolId);
  if (selectedSchoolId !== schoolId) return; // picked another school meanwhile
  if (result.reachable) {
    setNetworkStatus("ok", `Reachable (${result.host})`);
    // The login belongs to the school, so its login page opens as soon as
    // the school is picked. The button stays as a way to try again.
    onConnectClick();
  } else {
    setNetworkStatus(
      "fail",
      `Can't reach ${result.host || "this school"}. Check your network or VPN.`
    );
  }
}

async function onConnectClick() {
  clearConnectError();
  resetConnectLog();

  if (!selectedSchoolId || connectBtn.textContent === "Waiting for login…") return;

  connectBtn.disabled = true;
  connectBtn.textContent = "Waiting for login…";

  // Wrapped in try/catch/finally so an unexpected rejection anywhere in
  // this flow (a bug, a bad IPC response, anything) always leaves the UI
  // in a recoverable state with a visible message — instead of silently
  // stuck on "Connecting…" forever with no feedback at all, which is what
  // was happening before this existed.
  try {
    if (unsubscribeStatus) unsubscribeStatus();
    unsubscribeStatus = window.api.onStatus((text) => appendConnectLog(text));

    // Opens the calendar's own login page in a window. BellForge never sees
    // the password; it keeps the login session that page creates.
    const result = await window.api.connect(selectedSchoolId);

    if (unsubscribeStatus) {
      unsubscribeStatus();
      unsubscribeStatus = null;
    }

    if (!result.ok) {
      showConnectError(result.error);
      return;
    }

    connectBtn.textContent = "Connected";

    const menu = await window.api.getScheduleMenu();
    if (!menu.ok) {
      showConnectError(menu.error);
      return;
    }
    applyScheduleMenu(menu);
    setSubtitle(menu.schoolName);
    enterApp(menu);
  } catch (err) {
    showConnectError(`Unexpected error: ${err.message}`);
  } finally {
    if (connectBtn.textContent !== "Connected") {
      connectBtn.disabled = !selectedSchoolId;
      connectBtn.textContent = "Log in";
    }
  }
}

// The calendar is home: once connected, it opens on the current month with
// today selected.
function enterApp(menu) {
  document.getElementById("school-name").textContent = menu.schoolName;
  connectView.hidden = true;
  appView.hidden = false;
  document.body.classList.add("app-mode");
  const now = new Date();
  loadMonth(now.getFullYear(), now.getMonth() + 1, { selectDate: todayStr() });
}

// Forgets the remembered school and starts again from the login card.
document.getElementById("change-school").addEventListener("click", async () => {
  if (creating || cal.busy) return;
  await window.api.forgetLastSchool();
  location.reload();
});

// --- schedule select helper --------------------------------------------

// Takes a fresh menu from the main process (after connecting, or after the
// builder saves a new schedule) and refreshes everything that lists
// schedules or colors.
function applyScheduleMenu(menu) {
  scheduleMenu = menu;
  populateScheduleSelect(document.getElementById("single-schedule"), false);

  const colorSelect = document.getElementById("block-color");
  colorSelect.innerHTML = "";
  for (const color of menu.colors) {
    const opt = document.createElement("option");
    opt.value = color;
    opt.textContent = color;
    colorSelect.appendChild(opt);
  }

  renderMySchedules();

  // A date-range table built before this refresh may list a schedule that
  // was just deleted; clear it so it gets regenerated from the new list.
  document.getElementById("range-table-wrap").hidden = true;
  document.querySelector("#range-table tbody").innerHTML = "";

  const warningsBox = document.getElementById("mode-warnings");
  warningsBox.textContent = menu.warnings.join("\n");
  warningsBox.hidden = menu.warnings.length === 0;
}

function populateScheduleSelect(selectEl, includeBlank) {
  selectEl.innerHTML = "";
  if (includeBlank) {
    const blank = document.createElement("option");
    blank.value = "blank";
    blank.textContent = "Blank (no school / no bells)";
    selectEl.appendChild(blank);
  }
  for (const item of scheduleMenu.items) {
    const opt = document.createElement("option");
    opt.value = item.key;
    opt.textContent = `${item.label} (${item.eventCount} events)`;
    selectEl.appendChild(opt);
  }
}

// --- Add bells menu ---------------------------------------------------------

const addBtn = document.getElementById("add-btn");
const addMenu = document.getElementById("add-menu");
const menuItems = [...addMenu.querySelectorAll(".menu-item")];

function openAddMenu() {
  addMenu.hidden = false;
  addBtn.setAttribute("aria-expanded", "true");
  menuItems[0].focus();
}
function closeAddMenu() {
  if (addMenu.hidden) return;
  addMenu.hidden = true;
  addBtn.setAttribute("aria-expanded", "false");
}

addBtn.addEventListener("click", () => (addMenu.hidden ? openAddMenu() : closeAddMenu()));
document.addEventListener("click", (e) => {
  if (!addMenu.hidden && !e.target.closest(".menu")) closeAddMenu();
});
addMenu.addEventListener("keydown", (e) => {
  const i = menuItems.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = (i + (e.key === "ArrowDown" ? 1 : -1) + menuItems.length) % menuItems.length;
    menuItems[next].focus();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!addMenu.hidden) {
    closeAddMenu();
    addBtn.focus();
  } else if (!sheet.hidden) {
    closeSheet();
  }
});

document.getElementById("mode-single").addEventListener("click", () => {
  document.getElementById("mode-notice").hidden = true;
  openSingle(cal.date ? [cal.date] : []);
});
document.getElementById("mode-range").addEventListener("click", () => {
  document.getElementById("mode-notice").hidden = true;
  showScreen("screen-range");
});
document.getElementById("mode-mine").addEventListener("click", () => {
  document.getElementById("mode-notice").hidden = true;
  document.getElementById("my-schedules-error").hidden = true;
  renderMySchedules();
  showScreen("screen-my-schedules");
});
document.getElementById("mode-build").addEventListener("click", () => {
  document.getElementById("mode-notice").hidden = true;
  showScreen("screen-builder");
  validateBlockForm();
});
document.querySelectorAll(".back-link[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.back));
});

// --- single-day screen -----------------------------------------------------
// Opened with no date (from the menu), one date (a day on the calendar), or
// several (days picked with Shift or Ctrl/Cmd): one schedule for them all.

let singleDates = []; // set when several days were picked on the calendar

function openSingle(dates) {
  const many = dates.length > 1;
  singleDates = many ? [...dates].sort() : [];
  document.getElementById("single-date-field").hidden = many;
  document.getElementById("single-dates-field").hidden = !many;
  document.getElementById("single-error").hidden = true;
  if (many) {
    const chips = document.getElementById("single-dates");
    chips.innerHTML = "";
    for (const d of singleDates) {
      const chip = document.createElement("span");
      chip.className = "date-chip";
      chip.textContent = shortDate(d);
      chips.appendChild(chip);
    }
  } else {
    document.getElementById("single-date").value = dates[0] || "";
  }
  showScreen("screen-single");
}

document.getElementById("single-review-btn").addEventListener("click", () => {
  const dates = singleDates.length > 0 ? singleDates : [document.getElementById("single-date").value].filter(Boolean);
  const scheduleKey = document.getElementById("single-schedule").value;
  const error = document.getElementById("single-error");
  error.hidden = dates.length > 0;
  if (dates.length === 0) {
    error.textContent = "Pick a date.";
    return;
  }
  pendingAssignments = dates.map((date) => ({ date, scheduleKey }));
  reviewOrigin = "screen-single";
  showReview();
});

// --- date-range screen -----------------------------------------------------

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function enumerateDates(startStr, endStr) {
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  const dates = [];
  while (cur <= end) {
    dates.push(formatDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function buildRangeTable(dates) {
  const tbody = document.querySelector("#range-table tbody");
  tbody.innerHTML = "";
  for (const date of dates) {
    const tr = document.createElement("tr");

    const tdDate = document.createElement("td");
    tdDate.className = "range-date";
    tdDate.textContent = date;

    const tdSelect = document.createElement("td");
    tdSelect.className = "range-select";
    const select = document.createElement("select");
    select.dataset.date = date;
    populateScheduleSelect(select, true);
    select.value = "blank";
    tdSelect.appendChild(select);

    tr.appendChild(tdDate);
    tr.appendChild(tdSelect);
    tbody.appendChild(tr);
  }
  document.getElementById("range-table-wrap").hidden = false;
}

function showRangeError(message) {
  const box = document.getElementById("range-error");
  box.textContent = message;
  box.hidden = !message;
}

document.getElementById("range-generate-btn").addEventListener("click", () => {
  const start = document.getElementById("range-start").value;
  const end = document.getElementById("range-end").value;
  const message =
    !start || !end
      ? "Pick both a start date and an end date."
      : end < start
        ? "The end date must be on or after the start date."
        : "";
  showRangeError(message);
  if (message) return;
  buildRangeTable(enumerateDates(start, end));
});

document.getElementById("range-review-btn").addEventListener("click", () => {
  const rows = document.querySelectorAll("#range-table tbody tr");
  const assignments = [];
  rows.forEach((tr) => {
    const select = tr.querySelector("select");
    if (select.value !== "blank") {
      assignments.push({ date: select.dataset.date, scheduleKey: select.value });
    }
  });
  if (assignments.length === 0) {
    showRangeError("Every date is set to Blank, so there's nothing to create.");
    return;
  }
  showRangeError("");
  pendingAssignments = assignments;
  reviewOrigin = "screen-range";
  showReview();
});

// --- my schedules -----------------------------------------------------------

// Lists only schedules added through the builder. Deleting takes two
// clicks: Delete swaps the row into a "Delete X?" confirm state first.
function renderMySchedules() {
  const list = document.getElementById("my-schedules-list");
  list.innerHTML = "";
  const mine = scheduleMenu.items.filter((item) => item.custom);
  if (mine.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "You haven't added any schedule types yet.";
    list.appendChild(empty);
    return;
  }

  for (const item of mine) {
    const row = document.createElement("div");
    row.className = "block-item";
    const text = document.createElement("span");
    text.className = "block-text";
    text.textContent = `${item.label} (${item.eventCount} events)`;
    text.title = text.textContent;
    const del = document.createElement("button");
    del.className = "block-remove";
    del.textContent = "Delete";
    del.addEventListener("click", () => confirmDelete(row, item));
    row.append(text, del);
    list.appendChild(row);
  }
}

function confirmDelete(row, item) {
  row.innerHTML = "";
  row.classList.add("confirming");
  const text = document.createElement("span");
  text.className = "block-text";
  text.textContent = `Delete "${item.label}"?`;
  const yes = document.createElement("button");
  yes.className = "block-confirm";
  yes.textContent = "Delete";
  const no = document.createElement("button");
  no.className = "block-cancel";
  no.textContent = "Cancel";
  no.addEventListener("click", renderMySchedules);
  yes.addEventListener("click", async () => {
    yes.disabled = true;
    const result = await window.api.deleteSchedule(item.key);
    if (!result.ok) {
      const box = document.getElementById("my-schedules-error");
      box.textContent = result.error;
      box.hidden = false;
      renderMySchedules();
      return;
    }
    document.getElementById("my-schedules-error").hidden = true;
    applyScheduleMenu(result.menu);
  });
  row.append(text, yes, no);
}

// --- schedule builder -------------------------------------------------------
// The renderer only collects input. Every rule (title length, time format,
// colors, ordering) is checked by the main process through
// engine/schedule-expand.js, the same code that loads schedules.

const builderBlocks = []; // [{ title, start, end?, color, details }]
const blockInputs = {
  title: document.getElementById("block-title"),
  details: document.getElementById("block-details"),
  start: document.getElementById("block-start"),
  end: document.getElementById("block-end"),
  color: document.getElementById("block-color"),
};
const pointCheckbox = document.getElementById("block-point");
const blockAddBtn = document.getElementById("block-add-btn");
const touched = new Set(); // fields the user has edited, so errors don't show on a blank form
let validationSeq = 0;

function readBlockForm() {
  const block = {
    title: blockInputs.title.value,
    start: blockInputs.start.value,
    color: blockInputs.color.value,
    details: blockInputs.details.value,
  };
  if (!pointCheckbox.checked) block.end = blockInputs.end.value;
  return block;
}

async function validateBlockForm() {
  const seq = ++validationSeq;
  const { errors } = await window.api.validateBlock(readBlockForm());
  if (seq !== validationSeq) return; // a newer keystroke already re-validated

  // Red borders only on fields the user has edited; once they've started a
  // block, list everything still missing so a disabled Add is never a mystery.
  for (const [field, input] of Object.entries(blockInputs)) {
    input.classList.toggle("invalid", errors.some((e) => e.field === field && touched.has(field)));
  }
  document.getElementById("block-errors").textContent =
    touched.size > 0 ? errors.map((e) => e.message).join(" ") : "";
  blockAddBtn.disabled = errors.length > 0;
}

for (const [field, input] of Object.entries(blockInputs)) {
  input.addEventListener("input", () => {
    touched.add(field);
    validateBlockForm();
  });
}
pointCheckbox.addEventListener("change", () => {
  blockInputs.end.disabled = pointCheckbox.checked;
  validateBlockForm();
});

function renderBuilderBlocks() {
  const list = document.getElementById("builder-blocks");
  list.innerHTML = "";
  if (builderBlocks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No blocks yet. Add the first one below.";
    list.appendChild(empty);
    return;
  }

  builderBlocks.forEach((block, i) => {
    const row = document.createElement("div");
    row.className = "block-item";

    const time = document.createElement("span");
    time.className = "block-time";
    time.textContent = block.end !== undefined ? `${block.start}-${block.end}` : `${block.start} (point)`;

    const text = document.createElement("span");
    text.className = "block-text";
    text.textContent = `${block.title} · ${block.color}${block.details ? ` · ${block.details}` : ""}`;
    text.title = text.textContent;

    const remove = document.createElement("button");
    remove.className = "block-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      builderBlocks.splice(i, 1);
      renderBuilderBlocks();
    });

    row.append(time, text, remove);
    list.appendChild(row);
  });
}

// Blocks are kept sorted by start time, so the list always reads in the
// order the bells will ring.
function addBuilderBlock(block) {
  const clean = { ...block, title: block.title.trim(), details: block.details.trim() };
  const at = builderBlocks.findIndex((b) => b.start > clean.start);
  builderBlocks.splice(at === -1 ? builderBlocks.length : at, 0, clean);
  renderBuilderBlocks();
}

blockAddBtn.addEventListener("click", async () => {
  const block = readBlockForm();
  const { errors } = await window.api.validateBlock(block);
  if (errors.length > 0) return;
  addBuilderBlock(block);

  // Next block usually starts right after this one, so keep the color and
  // move the start time on; clear the rest.
  blockInputs.title.value = "";
  blockInputs.details.value = "";
  blockInputs.start.value = block.end || block.start;
  blockInputs.end.value = "";
  pointCheckbox.checked = false;
  blockInputs.end.disabled = false;
  touched.clear();
  validateBlockForm();
  blockInputs.title.focus();
});

function showImportNotice(text) {
  const notice = document.getElementById("import-notice");
  notice.textContent = text;
  notice.hidden = !text;
}

// Import only fills the block list, the same list the manual form adds
// to. The user can keep adding or removing blocks, and saving still goes
// through Preview.
document.getElementById("import-csv-btn").addEventListener("click", async () => {
  showImportNotice("");
  const result = await window.api.importScheduleCsv();
  if (result.canceled) return;
  if (!result.ok) {
    showBuilderError(["Nothing was imported. Fix these and import again:", ...result.errors]);
    return;
  }
  showBuilderError([]);
  for (const block of result.blocks) {
    addBuilderBlock({ ...block, details: block.details || "" });
  }
  const labelInput = document.getElementById("builder-label");
  if (!labelInput.value.trim()) {
    // "spring_pep-rally" -> "Spring Pep Rally"
    labelInput.value = result.fileName
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }
  showImportNotice(
    `Imported ${result.blocks.length} block${result.blocks.length === 1 ? "" : "s"} from ` +
      `${result.fileName}.csv. Check them above, then Preview.`
  );
});

document.getElementById("csv-template-btn").addEventListener("click", async () => {
  showImportNotice("");
  const result = await window.api.saveCsvTemplate();
  if (result.canceled) return;
  if (!result.ok) {
    showBuilderError([result.error]);
    return;
  }
  showBuilderError([]);
  showImportNotice(`Template saved to ${result.filePath}. Fill it in, save it as CSV, then Import CSV.`);
});

function showBuilderError(messages) {
  const box = document.getElementById("builder-error");
  box.textContent = messages.join("\n");
  box.hidden = messages.length === 0;
}

document.getElementById("builder-preview-btn").addEventListener("click", async () => {
  const label = document.getElementById("builder-label").value;
  const result = await window.api.previewSchedule(label, builderBlocks);
  if (!result.ok) {
    showBuilderError(result.errors);
    return;
  }
  showBuilderError([]);

  document.getElementById("preview-heading").textContent =
    `${label.trim()}: ${result.events.length} events`;
  const list = document.getElementById("preview-list");
  list.innerHTML = "";
  for (const event of result.events) {
    const row = document.createElement("div");
    const isAuto = event.color === "Grey" && (event.title === "Pass" || event.title === "Dismissal");
    row.className = isAuto ? "review-item auto" : "review-item";
    const left = document.createElement("span");
    left.textContent = `${event.start}  ${event.title}`;
    const right = document.createElement("span");
    right.className = "review-schedule";
    right.textContent = `${event.color} · ${event.details}`;
    row.append(left, right);
    list.appendChild(row);
  }
  document.getElementById("preview-error").hidden = true;
  showScreen("screen-builder-preview");
});

document.getElementById("builder-save-btn").addEventListener("click", async () => {
  const saveBtn = document.getElementById("builder-save-btn");
  const label = document.getElementById("builder-label").value;
  saveBtn.disabled = true;
  try {
    const result = await window.api.saveSchedule(label, builderBlocks);
    if (!result.ok) {
      const box = document.getElementById("preview-error");
      box.textContent = result.errors.join("\n");
      box.hidden = false;
      return;
    }
    applyScheduleMenu(result.menu);

    builderBlocks.length = 0;
    renderBuilderBlocks();
    showImportNotice("");
    document.getElementById("builder-label").value = "";
    for (const input of Object.values(blockInputs)) {
      if (input.tagName === "INPUT") input.value = "";
    }
    touched.clear();

    const notice = document.getElementById("mode-notice");
    notice.textContent = `Saved "${label.trim()}". It's now in the schedule list.`;
    notice.hidden = false;
    showScreen("screen-calendar");
  } finally {
    saveBtn.disabled = false;
  }
});

renderBuilderBlocks();

// --- calendar: view and delete bells ----------------------------------------
// Each month comes straight from the live calendar (read-month), so the
// grid shows what's on the calendar right now. Deleting goes back through
// the main process, which only accepts bells from its latest read. All text
// from the calendar is set with textContent, never parsed as HTML.

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const cal = {
  year: null,
  month: null,
  data: null, // latest read-month result for year/month
  date: null, // the day whose bells the panel shows, "YYYY-MM-DD"
  days: new Set(), // every day picked (Shift/Ctrl-click picks more than one)
  anchor: null, // where a Shift-click run starts
  selected: new Set(), // ids of bells ticked in the day panel
  busy: false,
};

const pad2 = (n) => String(n).padStart(2, "0");
const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function todayStr() {
  return formatDate(new Date());
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function longDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1]} ${d}`;
}

// "Tue, Nov 24"
function shortDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()].slice(0, 3)}, ${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

// "past" = already rang, "upcoming" = later today and hasn't rung yet,
// "future" = a later day. Uses this computer's clock.
function bellTiming(dateStr, start) {
  const today = todayStr();
  if (dateStr < today) return "past";
  if (dateStr > today) return "future";
  return toMinutes(start) <= nowMinutes() ? "past" : "upcoming";
}

// Time window for the bell strips: 6:00 to 18:00, stretched to fit any
// bell outside it, so every strip on screen uses the same scale.
function timeRange(days) {
  let lo = 6 * 60;
  let hi = 18 * 60;
  for (const day of days) {
    for (const e of day.events) {
      const t = toMinutes(e.start);
      if (Number.isNaN(t)) continue;
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  }
  return [Math.floor(lo / 60) * 60, Math.ceil((hi + 1) / 60) * 60];
}

const atPct = (t, [lo, hi]) => `${((t - lo) / (hi - lo)) * 100}%`;

// One mark per bell, placed by time and colored like the calendar.
function renderStrip(track, events, range, { selected, now } = {}) {
  track.innerHTML = "";
  for (const e of events) {
    const t = toMinutes(e.start);
    if (Number.isNaN(t)) continue;
    const mark = document.createElement("span");
    mark.className = selected && selected.has(e.id) ? "mark selected" : "mark";
    mark.style.left = atPct(t, range);
    mark.style.background = e.color || "var(--muted)";
    mark.title = `${e.start} ${e.title}`;
    track.appendChild(mark);
  }
  if (now != null && now >= range[0] && now <= range[1]) {
    const line = document.createElement("span");
    line.className = "now";
    line.style.left = atPct(now, range);
    line.title = "Now";
    track.appendChild(line);
  }
}

// Repeating bells are left alone: deleting one might remove the whole series.
const canDelete = (e) => e.deletable && !e.repeating;

function currentDay() {
  if (!cal.data || !cal.date) return null;
  return cal.data.days.find((d) => d.date === cal.date && d.inMonth) || null;
}

function monthDays() {
  return cal.data ? cal.data.days.filter((d) => d.inMonth) : [];
}

function setCalStatus(text) {
  const el = document.getElementById("cal-status");
  el.textContent = text;
  el.hidden = !text;
}

function setCalError(text) {
  const el = document.getElementById("cal-error");
  el.textContent = text;
  el.hidden = !text;
}

function renderCalendar() {
  document.getElementById("cal-title").textContent = cal.year ? `${MONTHS[cal.month - 1]} ${cal.year}` : "";
  for (const id of ["cal-prev", "cal-next", "cal-today", "cal-refresh"]) {
    document.getElementById(id).disabled = cal.busy;
  }

  const grid = document.getElementById("cal-grid");
  grid.innerHTML = "";
  if (!cal.data) return;

  const range = timeRange(monthDays());
  const today = todayStr();
  for (const day of cal.data.days) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-day";
    const dow = new Date(day.year, day.month - 1, day.day).getDay();
    if (dow === 0 || dow === 6) cell.classList.add("weekend");
    if (!day.inMonth) cell.classList.add("out");
    if (day.date === today) cell.classList.add("today");
    const picked = day.inMonth && cal.days.has(day.date);
    if (picked) cell.classList.add("selected");
    cell.setAttribute("aria-pressed", String(picked));
    cell.disabled = !day.inMonth || cal.busy;
    const n = day.events.length;
    cell.setAttribute("aria-label", `${longDate(day.date)}, ${n === 0 ? "no bells" : plural(n, "bell")}`);

    const top = document.createElement("span");
    top.className = "cal-top";
    const num = document.createElement("span");
    num.className = "cal-num";
    num.textContent = day.day;
    const count = document.createElement("span");
    count.className = "cal-count";
    count.textContent = n > 0 ? String(n) : "";
    top.append(num, count);

    const strip = document.createElement("span");
    strip.className = "mini-strip";
    if (day.inMonth) renderStrip(strip, day.events, range);

    cell.append(top, strip);
    cell.addEventListener("click", (e) => selectDay(day.date, e));
    grid.appendChild(cell);
  }
}

// A plain click picks one day. Shift-click picks the school days (Monday
// to Friday) from the last click to this one, plus the two days clicked;
// Ctrl-click (Cmd-click on Mac) adds or removes any one day, weekends too.
function selectDay(date, e = {}) {
  if (e.shiftKey && cal.anchor) {
    const [from, to] = [cal.anchor, date].sort();
    const weekday = (d) => ![0, 6].includes(new Date(d.year, d.month - 1, d.day).getDay());
    cal.days = new Set(
      monthDays()
        .filter((d) => d.date === from || d.date === to || (d.date > from && d.date < to && weekday(d)))
        .map((d) => d.date)
    );
  } else if (e.metaKey || e.ctrlKey) {
    if (cal.days.has(date)) cal.days.delete(date);
    else cal.days.add(date);
    cal.anchor = date;
  } else {
    cal.days = new Set([date]);
    cal.anchor = date;
  }
  cal.date = cal.days.has(date) ? date : [...cal.days].pop() || null;
  cal.selected.clear();
  document.getElementById("delete-result").hidden = true;
  document.getElementById("delete-meter").hidden = true;
  closeConfirm();
  renderCalendar();
  renderDayPanel();
}

function renderDayPanel() {
  const day = currentDay();
  const many = cal.days.size > 1;
  document.getElementById("day-empty").hidden = many || !!day;
  document.getElementById("day-one").hidden = many || !day;
  document.getElementById("day-many").hidden = !many;
  if (many) return renderManyDays();
  if (!day) return;

  const n = day.events.length;
  document.getElementById("day-title").textContent = longDate(day.date);
  document.getElementById("day-count").textContent = n === 0 ? "No bells" : plural(n, "bell");

  renderDayStrip();

  const list = document.getElementById("day-list");
  list.innerHTML = "";
  if (n === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No bells on this day.";
    list.appendChild(empty);
  }
  for (const e of day.events) {
    const timing = bellTiming(day.date, e.start);
    const row = document.createElement("label");
    row.className = "bell-row";
    if (!canDelete(e)) row.classList.add("locked");
    if (cal.selected.has(e.id)) row.classList.add("selected");

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = cal.selected.has(e.id);
    box.disabled = !canDelete(e) || cal.busy;
    box.addEventListener("change", () => {
      if (box.checked) cal.selected.add(e.id);
      else cal.selected.delete(e.id);
      row.classList.toggle("selected", box.checked);
      renderDayStrip();
      renderDayActions();
    });

    const time = document.createElement("span");
    time.className = "bell-time";
    time.textContent = e.start;
    const swatch = document.createElement("span");
    swatch.className = "bell-swatch";
    swatch.style.background = e.color || "var(--muted)";
    const title = document.createElement("span");
    title.className = "bell-title";
    title.textContent = e.title;
    const details = document.createElement("span");
    details.className = "bell-details";
    details.textContent = e.details && e.details !== e.title ? e.details : "";
    details.title = details.textContent;
    row.append(box, time, swatch, title, details);

    const tag =
      e.repeating ? ["Repeats", ""] :
      !e.deletable ? ["Can't delete here", ""] :
      timing === "upcoming" ? ["Later today", "upcoming"] :
      timing === "past" && day.date === todayStr() ? ["Rang", ""] : null;
    if (tag) {
      const t = document.createElement("span");
      t.className = tag[1] ? `bell-tag ${tag[1]}` : "bell-tag";
      t.textContent = tag[0];
      row.appendChild(t);
    }
    list.appendChild(row);
  }

  renderDayActions();
}

// Several days picked: list them, then apply one schedule to all of them.
function renderManyDays() {
  const days = monthDays().filter((d) => cal.days.has(d.date));
  const bells = days.reduce((n, d) => n + d.events.length, 0);
  document.getElementById("many-title").textContent = `${plural(days.length, "day")} selected`;
  document.getElementById("many-count").textContent =
    bells === 0 ? "No bells on them yet" : `${plural(bells, "bell")} on them already`;
  const list = document.getElementById("many-list");
  list.innerHTML = "";
  for (const d of days) {
    const row = document.createElement("div");
    row.className = "bell-row locked";
    const date = document.createElement("span");
    date.className = "bell-title";
    date.textContent = longDate(d.date);
    const count = document.createElement("span");
    count.className = "bell-details";
    count.textContent = d.events.length === 0 ? "No bells" : plural(d.events.length, "bell");
    row.append(date, count);
    list.appendChild(row);
  }
  document.getElementById("many-apply").disabled = cal.busy;
}

document.getElementById("many-apply").addEventListener("click", () => openSingle([...cal.days]));
document.getElementById("day-apply").addEventListener("click", () => cal.date && openSingle([cal.date]));
document.getElementById("many-clear").addEventListener("click", () => {
  cal.days = cal.date ? new Set([cal.date]) : new Set();
  renderCalendar();
  renderDayPanel();
});

function renderDayStrip() {
  const day = currentDay();
  const wrap = document.getElementById("day-strip");
  wrap.innerHTML = "";
  if (!day) return;
  // Same scale as the month grid, so a day here lines up with its cell.
  const range = timeRange(monthDays());
  const track = document.createElement("div");
  track.className = "strip-track";
  renderStrip(track, day.events, range, {
    selected: cal.selected,
    now: day.date === todayStr() ? nowMinutes() : null,
  });
  const axis = document.createElement("div");
  axis.className = "strip-axis";
  for (let t = range[0]; t <= range[1]; t += 120) {
    const label = document.createElement("span");
    label.style.left = atPct(t, range);
    label.textContent = `${pad2(Math.floor(t / 60))}:00`;
    axis.appendChild(label);
  }
  wrap.append(track, axis);
}

function renderDayActions() {
  const day = currentDay();
  const deletable = day ? day.events.filter(canDelete) : [];
  const k = cal.selected.size;
  document.getElementById("day-apply").disabled = cal.busy;
  document.getElementById("day-select-all").disabled = cal.busy || deletable.length === 0;
  document.getElementById("day-select-none").disabled = cal.busy || k === 0;
  const del = document.getElementById("day-delete");
  del.disabled = cal.busy || k === 0;
  del.textContent = k === 0 ? "Delete selected" : `Delete ${plural(k, "bell")}`;
}

document.getElementById("day-select-all").addEventListener("click", () => {
  const day = currentDay();
  if (!day) return;
  for (const e of day.events) if (canDelete(e)) cal.selected.add(e.id);
  renderDayPanel();
});

document.getElementById("day-select-none").addEventListener("click", () => {
  cal.selected.clear();
  renderDayPanel();
});

function selectedBells() {
  const day = currentDay();
  return day ? day.events.filter((e) => cal.selected.has(e.id)) : [];
}

function closeConfirm() {
  document.getElementById("confirm-panel").hidden = true;
  document.getElementById("day-actions").hidden = false;
}

// Asking first is BellForge's job (the calendar's own popup is never
// shown). Bells later today that haven't rung yet get a stronger warning
// and need an extra tick before Delete unlocks.
function openConfirm() {
  const day = currentDay();
  const bells = selectedBells();
  if (!day || bells.length === 0) return;
  const upcoming = bells.filter((e) => bellTiming(day.date, e.start) === "upcoming");

  document.getElementById("confirm-text").textContent =
    `Delete ${plural(bells.length, "bell")} from ${longDate(day.date)}? ` +
    `They'll be removed from the calendar. This can't be undone.`;

  const list = document.getElementById("confirm-list");
  list.innerHTML = "";
  for (const e of bells) {
    const item = document.createElement("span");
    item.textContent = `${e.start} ${e.title}`;
    list.appendChild(item);
  }

  const warning = document.getElementById("confirm-warning");
  const ackRow = document.getElementById("confirm-ack-row");
  const ack = document.getElementById("confirm-ack");
  const confirmBtn = document.getElementById("confirm-delete");
  ack.checked = false;
  if (upcoming.length > 0) {
    const one = upcoming.length === 1;
    const which =
      upcoming.length === bells.length
        ? one ? "This bell is" : "These bells are"
        : `${upcoming.length} of these bells ${one ? "is" : "are"}`;
    warning.textContent =
      `${which} later today and ${one ? "hasn't" : "haven't"} rung yet: ` +
      `${upcoming.map((e) => `${e.start} ${e.title}`).join(", ")}. ` +
      `If you delete ${one ? "it, it" : "them, they"} won't ring today.`;
    document.querySelector("#confirm-ack-row span").textContent =
      `I understand ${one ? "this bell" : "these bells"} won't ring today`;
  }
  warning.hidden = upcoming.length === 0;
  ackRow.hidden = upcoming.length === 0;
  confirmBtn.disabled = upcoming.length > 0;
  confirmBtn.textContent = `Delete ${plural(bells.length, "bell")}`;

  document.getElementById("delete-result").hidden = true;
  document.getElementById("day-actions").hidden = true;
  document.getElementById("confirm-panel").hidden = false;
}

document.getElementById("confirm-ack").addEventListener("change", (e) => {
  document.getElementById("confirm-delete").disabled = !e.target.checked;
});
document.getElementById("day-delete").addEventListener("click", openConfirm);
document.getElementById("confirm-cancel").addEventListener("click", closeConfirm);

function setDeleteMeter(done, total, text) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById("delete-fill").style.width = `${pct}%`;
  document.getElementById("delete-pct").textContent = `${pct}%`;
  document.getElementById("delete-meter").setAttribute("aria-valuenow", String(pct));
  if (text) document.getElementById("delete-count").textContent = text;
}

document.getElementById("confirm-delete").addEventListener("click", async () => {
  const day = currentDay();
  const bells = selectedBells();
  if (!day || bells.length === 0) return;

  closeConfirm();
  cal.busy = true;
  renderCalendar();
  renderDayPanel();

  const meter = document.getElementById("delete-meter");
  const summary = document.getElementById("delete-result");
  meter.classList.remove("fail", "done");
  meter.hidden = false;
  summary.hidden = true;
  setDeleteMeter(0, bells.length, `Deleting 1 of ${bells.length}`);

  const unsubscribe = window.api.onDeleteProgress((p) => {
    if (p.type === "start") {
      setDeleteMeter(p.index - 1, p.total, `Deleting ${p.index} of ${p.total}: ${p.event.start} ${p.event.title}`);
    } else if (p.type === "ok") {
      setDeleteMeter(p.index, p.total);
    } else if (p.type === "fail") {
      meter.classList.add("fail");
    } else if (p.type === "verify") {
      document.getElementById("delete-count").textContent = "Checking the calendar";
    }
  });

  let result;
  try {
    result = await window.api.deleteBells(bells.map((e) => ({ date: day.date, id: e.id })));
  } catch (err) {
    result = { ok: false, error: err.message };
  } finally {
    unsubscribe();
  }

  const key = `${cal.year}-${pad2(cal.month)}`;
  if (result.months && result.months[key]) cal.data = { ok: true, ...result.months[key] };
  cal.selected.clear();
  cal.busy = false;

  if (result.ok) {
    meter.classList.add("done");
    setDeleteMeter(result.deleted, result.deleted, `Deleted ${plural(result.deleted, "bell")}`);
    summary.className = "progress-summary success";
    summary.textContent = `Deleted ${plural(result.deleted, "bell")} from ${longDate(day.date)}.`;
  } else {
    meter.classList.add("fail");
    const parts = [];
    if (result.failed) {
      parts.push(
        `Stopped after deleting ${result.deleted} of ${result.requested}. ` +
          `${result.failed.start} ${result.failed.title} wasn't deleted (the calendar answered ${result.failed.status}).`
      );
    }
    if (result.stillThere && result.stillThere.length > 0) {
      parts.push(`These still show on the calendar: ${result.stillThere.join(", ")}.`);
    }
    if (parts.length === 0) parts.push(result.error || "The delete stopped without an error message.");
    if (result.requested === undefined) meter.hidden = true; // rejected before anything was sent
    document.getElementById("delete-count").textContent = "Stopped";
    summary.className = "progress-summary fail";
    summary.textContent = parts.join(" ");
  }
  summary.hidden = false;
  renderCalendar();
  renderDayPanel();
});

async function loadMonth(year, month, { selectDate } = {}) {
  cal.year = year;
  cal.month = month;
  cal.busy = true;
  setCalError("");
  setCalStatus(`Loading ${MONTHS[month - 1]} ${year} from the calendar`);
  renderCalendar();

  let result;
  try {
    result = await window.api.readMonth(year, month);
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  cal.busy = false;
  setCalStatus("");

  if (!result.ok) {
    cal.data = null;
    setCalError(result.error);
    renderCalendar();
    renderDayPanel();
    return;
  }

  cal.data = result;
  const prefix = `${year}-${pad2(month)}`;
  if (selectDate) {
    cal.date = selectDate;
    cal.days = new Set([selectDate]);
    cal.anchor = selectDate;
    cal.selected.clear();
  } else if (!cal.date || !cal.date.startsWith(prefix)) {
    cal.date = todayStr().startsWith(prefix) ? todayStr() : null;
    cal.days = new Set(cal.date ? [cal.date] : []);
    cal.anchor = cal.date;
    cal.selected.clear();
  } else {
    // Same month reloaded: keep ticks only on bells that are still there.
    const day = currentDay();
    const ids = new Set(day ? day.events.map((e) => e.id) : []);
    for (const id of [...cal.selected]) if (!ids.has(id)) cal.selected.delete(id);
  }
  renderCalendar();
  renderDayPanel();
}

function shiftMonth(delta) {
  const d = new Date(cal.year, cal.month - 1 + delta, 1);
  loadMonth(d.getFullYear(), d.getMonth() + 1);
}

document.getElementById("cal-prev").addEventListener("click", () => shiftMonth(-1));
document.getElementById("cal-next").addEventListener("click", () => shiftMonth(1));
document.getElementById("cal-refresh").addEventListener("click", () => loadMonth(cal.year, cal.month));
document.getElementById("cal-today").addEventListener("click", () => {
  const now = new Date();
  loadMonth(now.getFullYear(), now.getMonth() + 1, { selectDate: todayStr() });
});


// --- review screen ---------------------------------------------------------

function showReview() {
  const list = document.getElementById("review-list");
  list.innerHTML = "";
  let total = 0;

  for (const { date, scheduleKey } of pendingAssignments) {
    const item = scheduleMenu.items.find((i) => i.key === scheduleKey);
    total += item ? item.eventCount : 0;

    const row = document.createElement("div");
    row.className = "review-item";
    const left = document.createElement("span");
    left.textContent = date;
    const right = document.createElement("span");
    right.className = "review-schedule";
    right.textContent = item ? `${item.label} (${item.eventCount})` : scheduleKey;
    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  }

  document.getElementById("review-total").textContent =
    `${plural(pendingAssignments.length, "day")}, ${plural(total, "event")} total`;
  showScreen("screen-review");
}

document.getElementById("review-back").addEventListener("click", () => {
  showScreen(reviewOrigin);
});

// --- progress screen ---------------------------------------------------------

function setMeter(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById("progress-fill").style.width = `${pct}%`;
  document.getElementById("progress-pct").textContent = `${pct}%`;
  document.getElementById("progress-count").textContent = `${done} of ${total} events created`;
  document.getElementById("progress-meter").setAttribute("aria-valuenow", String(pct));
}

function appendProgressLine(p, multiDate) {
  const log = document.getElementById("progress-log");
  const line = document.createElement("div");

  if (p.type === "date-start") {
    line.className = "line heading";
    line.textContent = `${p.date}: ${p.label}`;
  } else if (p.type === "event-start") {
    line.className = "line";
    const overallSuffix = multiDate ? ` (${p.overallIndex}/${p.totalEvents} overall)` : "";
    line.textContent = `Creating ${p.index}/${p.countForDate}${overallSuffix}: ${p.event.title} @ ${p.event.start}`;
  } else if (p.type === "event-fail") {
    line.className = "line fail";
    line.textContent = `Failed: ${p.error}`;
  } else if (p.type === "verify") {
    line.className = "line heading";
    line.textContent = "Checking the calendar…";
  } else {
    return; // event-ok: no separate line, to keep the log short
  }

  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

document.getElementById("review-confirm-btn").addEventListener("click", async () => {
  creating = true;
  refreshAfterRun = true;
  showScreen("screen-progress");
  const log = document.getElementById("progress-log");
  const summary = document.getElementById("progress-summary");
  const doneBtn = document.getElementById("progress-done-btn");
  log.innerHTML = "";
  summary.hidden = true;
  doneBtn.hidden = true;
  document.getElementById("progress-heading").textContent = "Creating events…";

  const total = pendingAssignments.reduce((sum, { scheduleKey }) => {
    const item = scheduleMenu.items.find((i) => i.key === scheduleKey);
    return sum + (item ? item.eventCount : 0);
  }, 0);
  const meter = document.getElementById("progress-meter");
  meter.classList.remove("fail", "done");
  setMeter(0, total);

  const multiDate = pendingAssignments.length > 1;
  const unsubscribe = window.api.onCreateProgress((p) => {
    appendProgressLine(p, multiDate);
    if (p.type === "event-ok") setMeter(p.overallIndex, p.totalEvents);
    if (p.type === "event-fail") meter.classList.add("fail");
  });

  let result;
  try {
    result = await window.api.createEvents(pendingAssignments);
  } catch (err) {
    result = { ok: false, error: err.message };
  } finally {
    unsubscribe();
    creating = false;
    sheetClose.hidden = false;
  }

  document.getElementById("progress-heading").textContent = result.ok ? "Done" : "Stopped";

  if (result.ok) {
    meter.classList.add("done");
  } else {
    // Say it in words too: the bar's red alone is too close to the
    // in-progress color in dark mode to signal a failure by itself.
    meter.classList.add("fail");
    const done = result.succeeded || 0;
    document.getElementById("progress-count").textContent = `Stopped after ${done} of ${total} events`;
  }

  if (result.ok) {
    summary.className = "progress-summary success";
    summary.textContent = `Created all ${result.totalEvents} events.`;
  } else if (result.haltedOn) {
    summary.className = "progress-summary fail";
    summary.textContent =
      `Stopped at ${result.haltedOn}. Created ${result.succeeded} of ${result.totalEvents} events. ` +
      `Close this to see what's on the calendar.`;
  } else if (result.missing && result.missing.length > 0) {
    summary.className = "progress-summary fail";
    summary.textContent =
      `Created ${result.succeeded} events, but ${plural(result.missing.length, "bell")} didn't show up ` +
      `on the calendar afterward: ${result.missing.join(", ")}. Check the calendar.`;
  } else {
    summary.className = "progress-summary fail";
    summary.textContent = result.error || "The run stopped without an error message.";
  }
  summary.hidden = false;
  doneBtn.hidden = false;
});

document.getElementById("progress-done-btn").addEventListener("click", () => {
  pendingAssignments = [];
  document.getElementById("range-table-wrap").hidden = true;
  document.querySelector("#range-table tbody").innerHTML = "";
  document.getElementById("range-start").value = "";
  document.getElementById("range-end").value = "";
  document.getElementById("single-date").value = "";
  showScreen("screen-calendar");
});

// --- wire up + boot ---------------------------------------------------------

schoolSelect.addEventListener("change", onSchoolChange);
connectBtn.addEventListener("click", onConnectClick);

// Last-resort safety net: an error anywhere that isn't already handled by
// a local try/catch should never leave the UI silently stuck with no
// feedback — surface it wherever the connect screen's error box is
// visible, since that's the one place always present regardless of which
// screen is showing.
function showUnexpected(message) {
  if (appView.hidden) showConnectError(`Unexpected error: ${message}`);
  else setCalError(`Unexpected error: ${message}`);
}
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  showUnexpected(e.reason && e.reason.message ? e.reason.message : e.reason);
});
window.addEventListener("error", (e) => {
  console.error(e.error);
  showUnexpected(e.message);
});

// Opens the last school's login straight away, once the splash is done, so
// most days it's splash, log in, calendar.
async function boot() {
  await loadSchools();
  const last = await window.api.getLastSchool();
  await window.splashDone;
  if (last && schools.some((s) => s.id === last) && !selectedSchoolId) {
    schoolSelect.value = last;
    onSchoolChange();
  }
}
boot();
