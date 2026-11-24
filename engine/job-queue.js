// job-queue.js
//
// Runs calendar changes (create, delete) one at a time in the background,
// in the order they were added, so the person using BellForge can carry on
// while the device works through them (about 15 s per bell).
//
// queue.add({ kind, label, dates, total, meta, run }) -> job
//   run(job, report) does the work and returns { ok, summary, ... }.
//   report({ done, total, text, line }) updates progress; `line` adds a line
//   to the job's log.
//
// A job that fails stops itself (run decides how) but not the jobs after
// it. The exception is an error that every later job would hit too: the
// device can't be reached, or the login was abandoned. Then the queue
// pauses, waiting jobs stay waiting, and resume() carries on.
//
// Events: "update" (anything changed; call snapshot()), "finished" (job).

const { EventEmitter } = require("events");

// Errors after which every later job would fail the same way.
const PAUSE_CODES = new Set(["UNREACHABLE", "LOGIN_CLOSED"]);
const LOG_LIMIT = 300;

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = [];
    this.nextId = 1;
    this.running = null;
    this.paused = null; // { reason } while paused
  }

  add({ kind, label, dates = [], total = 0, meta = {}, run }) {
    const job = {
      id: this.nextId++,
      kind,
      label,
      dates: [...new Set(dates)].sort(),
      meta,
      status: "queued", // queued | running | done | failed | cancelled
      progress: { done: 0, total, text: "Waiting" },
      log: [],
      result: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      run,
    };
    this.jobs.push(job);
    this.changed();
    this.pump();
    return job;
  }

  // Only a job that hasn't started can be cancelled: one already running
  // has bells half sent, and stopping it midway would leave the day in a
  // state nobody chose.
  cancel(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status !== "queued") return false;
    job.status = "cancelled";
    job.finishedAt = Date.now();
    job.progress.text = "Cancelled";
    this.changed();
    return true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = null;
    this.changed();
    this.pump();
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => j.status === "queued" || j.status === "running");
    this.changed();
  }

  // Jobs still to run or running; what quitting would lose.
  get active() {
    return this.jobs.filter((j) => j.status === "queued" || j.status === "running");
  }

  async pump() {
    if (this.running || this.paused) return;
    const job = this.jobs.find((j) => j.status === "queued");
    if (!job) return;

    this.running = job;
    job.status = "running";
    job.startedAt = Date.now();
    job.progress.text = "Starting";
    this.changed();

    const report = ({ done, total, text, line } = {}) => {
      if (done !== undefined) job.progress.done = done;
      if (total !== undefined) job.progress.total = total;
      if (text !== undefined) job.progress.text = text;
      if (line) {
        job.log.push(line);
        if (job.log.length > LOG_LIMIT) job.log.splice(0, job.log.length - LOG_LIMIT);
      }
      this.changed();
    };

    let result;
    try {
      result = await job.run(job, report);
    } catch (err) {
      result = { ok: false, summary: err.message, code: err.code };
    }
    result = result || { ok: false, summary: "The job ended without a result." };

    job.result = result;
    job.status = result.ok ? "done" : "failed";
    job.finishedAt = Date.now();
    job.progress.text = result.ok ? "Done" : "Stopped";
    this.running = null;
    if (!result.ok && PAUSE_CODES.has(result.code) && this.jobs.some((j) => j.status === "queued")) {
      this.paused = { reason: result.summary };
    }
    this.changed();
    this.emit("finished", job);
    this.pump();
  }

  changed() {
    this.emit("update");
  }

  // What the screen is sent: everything but the run function.
  snapshot() {
    return {
      paused: this.paused,
      jobs: this.jobs.map(({ run, ...job }) => ({ ...job, progress: { ...job.progress }, log: [...job.log] })),
    };
  }
}

module.exports = { JobQueue, PAUSE_CODES };
