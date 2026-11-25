// Tests for accounts and the activity log. Run: npm test (from the repo root).
// Each test works in its own temporary folder; nothing outside it is touched.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { listAccounts, createAccount, displayName } = require("../accounts");
const { appendActivity, readActivity, toCsv, logPath } = require("../activity-log");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bellforge-test-"));

// Accounts: create, list, reject blanks and duplicates, notes tell apart.
{
  const dir = tmp();
  assert.deepStrictEqual(listAccounts(dir), [], "no file yet means no accounts");
  assert.strictEqual(createAccount(dir, { name: "   " }).ok, false);
  const a = createAccount(dir, { name: "  Samir   Ali " });
  assert.ok(a.ok);
  assert.strictEqual(a.account.name, "Samir Ali");
  const dup = createAccount(dir, { name: "samir ali" });
  assert.strictEqual(dup.ok, false, "same name, any case, is a duplicate");
  assert.match(dup.errors[0], /Add a note/);
  const b = createAccount(dir, { name: "Samir Ali", note: "Front office" });
  assert.ok(b.ok, "a note tells two people with one name apart");
  assert.strictEqual(displayName(b.account), "Samir Ali (Front office)");
  assert.strictEqual(createAccount(dir, { name: "x".repeat(61) }).ok, false);
  assert.deepStrictEqual(listAccounts(dir).map(displayName), ["Samir Ali", "Samir Ali (Front office)"]);
  fs.writeFileSync(path.join(dir, "accounts.json"), "{ not json");
  assert.deepStrictEqual(listAccounts(dir), [], "a damaged file reads as empty, never crashes");
}

// Activity log: append-only, newest first, filters, survives a damaged line.
{
  const dir = tmp();
  assert.deepStrictEqual(readActivity(dir), []);
  const school = { id: "odea", name: "O'Dea High School" };
  const samir = { id: "u1", name: "Samir Ali" };
  const first = appendActivity(dir, { kind: "create", label: "Maroon Day on Sat, Nov 28", dates: ["2026-11-28"], school, user: samir, ok: true, summary: "Created 14 bells on Sat, Nov 28." });
  assert.ok(first.id && first.at && "computer" in first && "osUser" in first, "who/when filled in automatically");
  fs.appendFileSync(logPath(dir), "{ half a line\n");
  appendActivity(dir, { kind: "delete", label: "Delete 2 bells from Sat, Nov 28", dates: ["2026-11-28"], school, user: { id: "u2", name: "Pat" }, ok: false, summary: 'Stopped after 1 of 2. "M1", the calendar answered 500' });
  assert.throws(() => appendActivity(dir, { kind: "bogus" }));

  const all = readActivity(dir);
  assert.strictEqual(all.length, 2, "the damaged line is skipped");
  assert.strictEqual(all[0].kind, "delete", "newest first");
  assert.strictEqual(readActivity(dir, { userId: "u1" }).length, 1);
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert.strictEqual(readActivity(dir, { from: ymd, to: ymd }).length, 2);
  assert.strictEqual(readActivity(dir, { to: "2000-01-01" }).length, 0);

  const csv = toCsv(all);
  const lines = csv.trim().split("\r\n");
  assert.strictEqual(lines.length, 3, "header plus one row per entry");
  assert.ok(lines[1].includes('"Stopped after 1 of 2. ""M1"", the calendar answered 500"'), "quotes and commas escaped");
  assert.strictEqual(toCsv([{ at: first.at, label: "=HYPERLINK(1)", dates: [] }]).split("\r\n")[1].split(",")[5], "'=HYPERLINK(1)", "formulas neutralised");
}
console.log("accounts and activity log: all passed");
