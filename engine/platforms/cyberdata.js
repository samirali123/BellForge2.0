// platforms/cyberdata.js
//
// The CyberData engine: reads, creates and deletes bells by sending the
// same HTTP requests the calendar's own page sends. No browser is involved.
// Any school on CyberData/InformaCast can use it by supplying its own
// colors and config.
//
// createEngine({ colors, pickerColors, config }) ->
//   { setSession, hasSession, readMonth, createEvent, deleteEvents }
//
// Logging in is not done here. The app shows the device's own login page
// and hands the resulting session cookie to setSession(). When the device
// says the session is no longer valid, calls throw a NotLoggedInError so
// the caller can ask the user to log in again and retry.
//
// Confirmed against the live device (2026-11-10):
// - Month page: GET <calendarUrl>?y=2026&m=11. Day cells are
//   <li class="day ..."> with data-year/data-month/data-day (months 1-12,
//   unpadded); spillover days from neighboring months add "othermonth" but
//   carry their real month. Each bell is <li class="task" data-id> with
//   <span class="time">HH:MM - 23:59</span>, the title as bare text, the
//   details in the following <p>, and an inline background-color.
// - Create: POST <calendar path>/new_task as a plain form. Every form key
//   must be present or the device answers 400. Success is a 302 back to the
//   calendar; an expired session is a 302 to /login instead.
// - Delete: DELETE <calendar path>/<y>/<m>/<d>/<id>, 200 on success. The
//   calendar's "X" button (data-remove="all") removes every occurrence of
//   a repeating bell; BellForge never sends that.
// - The device answers one request at a time, about 15 s per create or
//   delete, so bells are sent one after another.

const https = require("https");

class NotLoggedInError extends Error {
  constructor() {
    super("The calendar login has expired. Log in again to continue.");
    this.code = "NOT_LOGGED_IN";
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(text) {
  // Decoded twice: the device double-escapes some text (details show up as
  // "&amp;nbsp;" for an empty field).
  const once = (s) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  return once(once(text));
}
const plainText = (html) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const pad2 = (n) => String(n).padStart(2, "0");

// Reads every day cell, and the bells in it, out of a month page.
function parseMonth(html) {
  const dayTags = [...html.matchAll(/<li\b[^>]*\bclass="[^"]*\bday\b[^"]*"[^>]*>/g)];
  return dayTags.map((m, i) => {
    const tag = m[0];
    const end = i + 1 < dayTags.length ? dayTags[i + 1].index : html.length;
    const cell = html.slice(m.index, end);
    const y = Number(attr(tag, "data-year"));
    const mo = Number(attr(tag, "data-month"));
    const d = Number(attr(tag, "data-day"));

    const taskStarts = [...cell.matchAll(/<li\b[^>]*\bclass="task\b[^"]*"[^>]*>/g)];
    const events = taskStarts.map((t, j) => {
      const chunk = cell.slice(t.index, j + 1 < taskStarts.length ? taskStarts[j + 1].index : cell.length);
      const time = (chunk.match(/<span\b[^>]*class="time"[^>]*>([^<]*)<\/span>/) || [, ""])[1];
      const afterTime = chunk.slice(chunk.indexOf("</span>") + 7);
      const title = plainText(afterTime.slice(0, afterTime.search(/<p\b|<a\b|<button\b|<\/li>|$/)));
      const detailsMatch = chunk.match(/<p\b[^>]*>([\s\S]*?)(?:<a\b|<button\b|<\/p>)/);
      const style = attr(t[0], "style") || "";
      // A repeating bell's delete may remove the whole series; none exist to
      // test against yet, so they're never deletable from BellForge.
      const repeating = /hide-recurrent-task/.test(chunk);
      return {
        id: attr(t[0], "data-id"),
        start: time.split("-")[0].trim(),
        title,
        details: detailsMatch ? plainText(detailsMatch[1]) : "",
        color: (style.match(/background-color:\s*([^;"]+)/) || [, ""])[1].trim(),
        deletable: /data-remove="single"/.test(chunk) && !repeating,
        repeating,
      };
    });
    events.sort((a, b) => a.start.localeCompare(b.start));
    return {
      date: `${y}-${pad2(mo)}-${pad2(d)}`,
      year: y,
      month: mo,
      day: d,
      inMonth: !/\bothermonth\b/.test(attr(tag, "class") || ""),
      events,
    };
  });
}

function createEngine({ colors, pickerColors, config }) {
  const base = new URL(config.calendarUrl);
  const calendarPath = base.pathname.replace(/\/$/, "");
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true }); // self-signed device cert
  let cookie = null;

  function setSession(sessionCookie) {
    cookie = sessionCookie || null;
  }
  const hasSession = () => !!cookie;

  function request(method, path, form) {
    if (!cookie) return Promise.reject(new NotLoggedInError());
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const headers = { "User-Agent": "BellForge", Accept: "text/html,*/*", Cookie: cookie };
    if (body !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    return new Promise((resolve, reject) => {
      const req = https.request(
        { host: base.hostname, port: base.port || 443, path, method, headers, agent, timeout: config.requestTimeoutMs },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const location = res.headers.location || "";
            if (/\/login\b/.test(location)) return reject(new NotLoggedInError());
            resolve({ status: res.statusCode, location, text: Buffer.concat(chunks).toString("utf8") });
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error("The calendar didn't answer in time.")));
      req.on("error", (err) =>
        reject(new Error(`Couldn't reach the calendar at ${base.hostname} (${err.message}). Check the school network or VPN.`))
      );
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  async function readMonth(year, month) {
    const res = await request("GET", `${calendarPath}?y=${year}&m=${month}`);
    if (res.status !== 200) throw new Error(`The calendar answered ${res.status} when opening ${year}-${pad2(month)}.`);
    const days = parseMonth(res.text);
    if (/id="login_form"/.test(res.text)) throw new NotLoggedInError();
    if (!days.some((d) => d.inMonth && d.year === year && d.month === month)) {
      throw new Error(`The calendar didn't show ${year}-${pad2(month)}.`);
    }
    return { year, month, days };
  }

  function colorHex(name) {
    const label = colors[name] || name;
    const hex = pickerColors[label];
    if (!hex) throw new Error(`"${name}" isn't one of the calendar's colors.`);
    return hex;
  }

  /**
   * Create one bell. Every bell is a one-off, non-recurring trigger at a
   * single point in time.
   * @param {{title: string, start: string, color: string, details?: string}} event
   * @param {string} dateStr - "YYYY-MM-DD"
   */
  async function createEvent(event, dateStr) {
    // The repeat fields are sent at the form's own defaults (Repeats left
    // unticked); the device rejects the form if any key is missing.
    const res = await request("POST", `${calendarPath}/new_task`, {
      title: event.title,
      startdate: dateStr,
      enddate: dateStr,
      start_time: event.start,
      end_time: config.endTime,
      stored_bell: config.audioFile,
      pgroup: config.pgroup,
      times_to_play: config.timesToPlay,
      relay_action: config.relayAction,
      repetition_type: "d",
      repetition_value_weekday: "0",
      repetition_value_monthday: "1",
      repetition_value: "1",
      repetition_hours: "0",
      repetition_mins: "0",
      details: event.details || event.title,
      color: colorHex(event.color),
    });
    if (res.status !== 302 || !res.location.includes(calendarPath)) {
      throw new Error(`The calendar didn't save "${event.title}" (it answered ${res.status}).`);
    }
  }

  /**
   * Delete bells, one at a time, then re-read every affected month to
   * confirm they're really gone. Stops at the first request that doesn't
   * come back 200. Callers are responsible for asking the user first.
   * @param {Array<{date: string, id: string, start?: string, title?: string}>} events
   */
  async function deleteEvents(events, { onProgress = () => {} } = {}) {
    for (const e of events) {
      if (!/^\d+$/.test(String(e.id)) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
        throw new Error(`Refusing to delete a bell with an unexpected id or date (${e.id} on ${e.date}).`);
      }
    }

    const total = events.length;
    const deleted = [];
    let failed = null;
    for (let i = 0; i < total; i++) {
      const e = events[i];
      const [y, m, d] = e.date.split("-").map(Number);
      onProgress({ type: "start", index: i + 1, total, event: e });
      let status;
      try {
        status = (await request("DELETE", `${calendarPath}/${y}/${m}/${d}/${e.id}`)).status;
      } catch (err) {
        if (err.code === "NOT_LOGGED_IN") throw Object.assign(err, { deleted });
        status = err.message;
      }
      if (status !== 200) {
        failed = { event: e, status };
        onProgress({ type: "fail", index: i + 1, total, event: e, status });
        break;
      }
      deleted.push(e);
      onProgress({ type: "ok", index: i + 1, total, event: e });
    }

    // Verify against what the calendar actually shows now, not just the
    // status codes.
    onProgress({ type: "verify", total });
    const months = {};
    try {
      for (const key of new Set(events.map((e) => e.date.slice(0, 7)))) {
        const [y, m] = key.split("-").map(Number);
        months[key] = await readMonth(y, m);
      }
    } catch (err) {
      // Tell the caller what was already deleted, so nothing is sent twice.
      throw Object.assign(err, { deleted });
    }
    const remaining = new Set(
      Object.values(months).flatMap((mo) => mo.days.flatMap((d) => d.events.map((ev) => `${d.date}#${ev.id}`)))
    );
    const stillThere = deleted.filter((e) => remaining.has(`${e.date}#${e.id}`));

    return { deleted, failed, stillThere, months };
  }

  return { setSession, hasSession, readMonth, createEvent, deleteEvents };
}

module.exports = { createEngine, NotLoggedInError, parseMonth };
