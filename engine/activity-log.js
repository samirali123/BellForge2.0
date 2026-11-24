// activity-log.js
//
// BellForge's record of every change it makes: bells created or deleted
// (including jobs that stopped partway) and schedule types saved or
// deleted. Kept on this computer in <dir>/activity.jsonl, one JSON entry per
// line, and only ever appended to: nothing in BellForge edits or removes an
// entry. Each entry is self-contained, so the file could later be sent to a
// server as it is.
//
// An entry:
//   { id, at, appVersion, school: { id, name },
//     user: { id, name } | null,          the BellForge account
//     osUser, computer,                    filled in automatically
//     kind: "create" | "delete" | "schedule-save" | "schedule-delete",
//     label, dates: [...],
//     ok, summary,                         how it ended, in words
//     details: { ... } }                   what changed (per kind)

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const KINDS = ["create", "delete", "schedule-save", "schedule-delete"];

function logPath(dir) {
  return path.join(dir, "activity.jsonl");
}

function whoAmI() {
  let osUser = "";
  try {
    osUser = os.userInfo().username;
  } catch {
    // Some locked-down accounts can't be looked up; the BellForge name still is.
  }
  return { osUser, computer: os.hostname() };
}

function appendActivity(dir, entry) {
  if (!KINDS.includes(entry.kind)) throw new Error(`Unknown activity kind "${entry.kind}".`);
  const full = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    ...whoAmI(),
    ...entry,
  };
  fs.mkdirSync(dir, { recursive: true });
  // One line, one write: an append of a single line can't interleave with
  // another, and a crash leaves at most one unreadable last line.
  fs.appendFileSync(logPath(dir), JSON.stringify(full) + "\n");
  return full;
}

// Newest first. from/to are "YYYY-MM-DD" (local dates, inclusive) and match
// when the change was made; userId keeps one person's changes.
function readActivity(dir, { from, to, userId } = {}) {
  let text = "";
  try {
    text = fs.readFileSync(logPath(dir), "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A damaged line (e.g. a crash mid-write) is skipped, not fatal.
    }
  }
  const localDate = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // Reversed first so entries written in the same millisecond still come
  // out newest first (the sort keeps their order).
  return entries
    .reverse()
    .filter((e) => (!from || localDate(e.at) >= from) && (!to || localDate(e.at) <= to))
    .filter((e) => !userId || (e.user && e.user.id === userId))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// For keeping records outside BellForge: one row per entry.
function toCsv(entries) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Guard against spreadsheet formulas in text that came from the calendar.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  // "2026-11-24 21:05", local time: sorts correctly and has no commas.
  const stamp = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const header = ["When", "Person", "Computer user", "Computer", "School", "What", "Dates", "Result", "Summary"];
  const rows = entries.map((e) => [
    stamp(e.at),
    e.user ? e.user.name : "",
    e.osUser,
    e.computer,
    e.school ? e.school.name : "",
    e.label,
    (e.dates || []).join(" "),
    e.ok ? "Done" : "Stopped",
    e.summary,
  ]);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

module.exports = { appendActivity, readActivity, toCsv, logPath, KINDS };
