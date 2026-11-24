// Tests for the job queue and the device lock. Run: npm test (from the repo root).
// No test framework: plain node and assert, so the engine stays dependency-free.
// The device is faked by replacing https.request, so nothing is sent anywhere.
const assert = require("assert");
const { JobQueue } = require("../job-queue");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // 1. Runs in order, one at a time; failure of one doesn't stop the next.
  const q = new JobQueue();
  const order = []; let concurrent = 0, maxConc = 0;
  const work = (name, ok = true, code) => async (job, report) => {
    concurrent++; maxConc = Math.max(maxConc, concurrent); order.push(name);
    report({ done: 1, total: 2, line: name }); await sleep(20); concurrent--;
    return ok ? { ok: true, summary: name } : { ok: false, summary: name + " failed", code };
  };
  q.add({ kind: "create", label: "A", run: work("A") });
  q.add({ kind: "create", label: "B", run: work("B", false) });
  const c = q.add({ kind: "delete", label: "C", run: work("C") });
  await sleep(200);
  assert.deepStrictEqual(order, ["A", "B", "C"]); assert.strictEqual(maxConc, 1);
  assert.deepStrictEqual(q.snapshot().jobs.map((j) => j.status), ["done", "failed", "done"]);
  assert.strictEqual(q.snapshot().jobs[0].log[0], "A"); assert.ok(!("run" in q.snapshot().jobs[0]));

  // 2. Cancel only queued; UNREACHABLE pauses and resume carries on.
  const q2 = new JobQueue(); const ran = [];
  q2.add({ kind: "create", label: "X", run: async () => { ran.push("X"); await sleep(20); return { ok: false, summary: "down", code: "UNREACHABLE" }; } });
  const y = q2.add({ kind: "create", label: "Y", run: async () => { ran.push("Y"); return { ok: true, summary: "y" }; } });
  const z = q2.add({ kind: "create", label: "Z", run: async () => { ran.push("Z"); return { ok: true, summary: "z" }; } });
  assert.strictEqual(q2.cancel(1), false, "running job can't be cancelled");
  assert.strictEqual(q2.cancel(z.id), true);
  await sleep(60);
  assert.deepStrictEqual(ran, ["X"]); assert.ok(q2.paused); assert.strictEqual(y.status, "queued");
  q2.resume(); await sleep(30);
  assert.deepStrictEqual(ran, ["X", "Y"]); assert.strictEqual(z.status, "cancelled"); assert.strictEqual(q2.paused, null);
  // A thrown error becomes a failed job.
  const q3 = new JobQueue();
  const t = q3.add({ kind: "x", label: "T", run: async () => { throw Object.assign(new Error("boom"), { code: "LOGIN_CLOSED" }); } });
  await sleep(10); assert.strictEqual(t.status, "failed"); assert.strictEqual(q3.paused, null, "nothing waiting, so no pause");
  q2.clearFinished(); assert.strictEqual(q2.snapshot().jobs.length, 0);
  console.log("queue: all passed");

  // 3. Engine lock: a screen read jumps ahead of waiting job requests.
  const https = require("https");
  const log = [];
  https.request = (opts, cb) => {
    const { EventEmitter } = require("events");
    const req = new EventEmitter();
    req.write = () => {}; req.destroy = () => {};
    req.end = () => { log.push(`start ${opts.method} ${opts.path}`); setTimeout(() => {
      const res = new EventEmitter(); res.statusCode = opts.method === "POST" ? 302 : 200;
      res.headers = { location: opts.method === "POST" ? "/calendar/cal" : "" };
      cb(res); res.emit("data", Buffer.from(opts.method === "GET" ? '<li class="day" data-year="2026" data-month="11" data-day="1"></li>' : "")); res.emit("end");
      log.push(`end ${opts.method}`); }, 30); };
    return req;
  };
  const { createEngine } = require("../platforms/cyberdata");
  const eng = createEngine({ colors: {}, pickerColors: { Red: "#FF4848" }, config: { calendarUrl: "https://h/calendar/cal", requestTimeoutMs: 1000, endTime: "23:59" } });
  eng.setSession("session=1");
  const ev = { title: "M1", start: "08:00", color: "Red" };
  const jobs = [eng.createEvent(ev, "2026-11-02"), eng.createEvent(ev, "2026-11-03"), eng.createEvent(ev, "2026-11-04")];
  await sleep(5);
  const read = eng.readMonth(2026, 11);
  await Promise.all([...jobs, read]);
  const starts = log.filter((l) => l.startsWith("start")).map((l) => l.split(" ")[1]);
  assert.deepStrictEqual(starts, ["POST", "GET", "POST", "POST"], "read should go second: " + starts);
  assert.ok(!log.some((l, i) => l.startsWith("start") && log[i - 1] && log[i - 1].startsWith("start")), "never two requests at once");
  console.log("engine lock: read served after the one in-flight request:", starts.join(" -> "));
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
