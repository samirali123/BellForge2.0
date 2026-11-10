// create-events.js
//
// The event-creation loop: walk an ordered list of assignments, create every
// event, halt immediately on the first failure, then re-read the calendar to
// confirm every created bell is really there. Callers get progress via a
// callback instead of this file assuming how progress is displayed.
//
// `assignments`: ordered list of { date, scheduleKey } — a single-day run
// is just a one-item list.
//
// onProgress is called with one of:
//   { type: "date-start", date, label }
//   { type: "event-start", date, index, countForDate, overallIndex, totalEvents, event }
//   { type: "event-ok", date, event, overallIndex, totalEvents }
//   { type: "event-fail", date, event, error }
//   { type: "verify" }

async function createEvents({ schedules, createEvent, readMonth, assignments, onProgress }) {
  const multiDate = assignments.length > 1;
  const totalEvents = assignments.reduce(
    (sum, a) => sum + schedules[a.scheduleKey].events.length,
    0
  );

  let succeeded = 0;
  let overallIndex = 0;
  let haltedOn = null;
  const created = [];

  for (const { date, scheduleKey } of assignments) {
    const schedule = schedules[scheduleKey];
    if (multiDate) onProgress({ type: "date-start", date, label: schedule.label });

    for (let i = 0; i < schedule.events.length; i++) {
      const event = schedule.events[i];
      overallIndex += 1;
      onProgress({
        type: "event-start",
        date,
        index: i + 1,
        countForDate: schedule.events.length,
        overallIndex,
        totalEvents,
        event,
      });
      try {
        await createEvent(event, date);
        succeeded += 1;
        created.push({ date, event });
        onProgress({ type: "event-ok", date, event, overallIndex, totalEvents });
      } catch (err) {
        onProgress({ type: "event-fail", date, event, error: err.message });
        haltedOn = `${date} ${event.title}`;
        break;
      }
    }
    if (haltedOn) break;
  }

  // Check the calendar itself, not just the device's answers: every bell
  // created should now be on its day, at its time, with its title.
  const missing = [];
  if (created.length > 0 && readMonth) {
    onProgress({ type: "verify" });
    const months = new Map();
    for (const { date, event } of created) {
      const key = date.slice(0, 7);
      if (!months.has(key)) {
        const [y, m] = key.split("-").map(Number);
        months.set(key, await readMonth(y, m));
      }
      const day = months.get(key).days.find((d) => d.date === date && d.inMonth);
      const found = day && day.events.some((e) => e.start === event.start && e.title === event.title);
      if (!found) missing.push(`${date} ${event.start} ${event.title}`);
    }
  }

  return { succeeded, totalEvents, haltedOn, missing };
}

module.exports = { createEvents };
