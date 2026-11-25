// accounts.js
//
// The people who use BellForge on this computer, so every change can be
// put down to someone. An account is just a name (plus an optional note to
// tell two people with the same name apart): no password, no personal
// details. Anyone can pick any name, so this records who did something
// among people who trust each other; it doesn't stop anyone pretending.
//
// Stored in <dir>/accounts.json, where dir is the app's user-data folder:
//   { "accounts": [{ "id", "name", "note", "createdAt" }] }

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_NAME = 60;
const MAX_NOTE = 40;

function accountsPath(dir) {
  return path.join(dir, "accounts.json");
}

function listAccounts(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(accountsPath(dir), "utf8"));
    return Array.isArray(data.accounts) ? data.accounts.filter((a) => a && a.id && a.name) : [];
  } catch {
    return [];
  }
}

// "Samir Ali" or "Samir Ali (IT)": how an account is shown everywhere.
const displayName = (a) => (a.note ? `${a.name} (${a.note})` : a.name);
// Collapses spacing so "Samir  Ali " and "Samir Ali" are the same name.
const tidy = (s) => String(s || "").replace(/\s+/g, " ").trim();

function createAccount(dir, { name, note }) {
  const clean = { name: tidy(name), note: tidy(note) };
  const errors = [];
  if (!clean.name) errors.push("Enter a name.");
  if (clean.name.length > MAX_NAME) errors.push(`Keep the name to ${MAX_NAME} characters.`);
  if (clean.note.length > MAX_NOTE) errors.push(`Keep the note to ${MAX_NOTE} characters.`);

  const accounts = listAccounts(dir);
  const key = (a) => displayName(a).toLowerCase();
  const existing = clean.name && accounts.find((a) => key(a) === key(clean));
  if (existing) {
    // Named as it's spelled in the list, which is what they'll look for.
    errors.push(
      clean.note
        ? `There's already an account called ${displayName(existing)}.`
        : `There's already an account called ${existing.name}. Add a note (like a department) to tell you apart, or pick that account.`
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  const account = { id: crypto.randomUUID(), name: clean.name, note: clean.note, createdAt: new Date().toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  // Written to a temporary file first, so a crash mid-write can't leave a
  // half-written list.
  const tmp = `${accountsPath(dir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ accounts: [...accounts, account] }, null, 2) + "\n");
  fs.renameSync(tmp, accountsPath(dir));
  return { ok: true, account };
}

module.exports = { listAccounts, createAccount, displayName };
