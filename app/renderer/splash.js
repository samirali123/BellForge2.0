// splash.js — the launch splash, played over the first screen.
//
//   0.0 s  the bell drops in, centered
//   0.6 s  it rings: two swings from the crown, the clapper swinging further
//   1.4 s  a spark flies off the rim and pushes the wordmark out to the
//          right, while the bell slides left so the logo ends up centered
//   2.3 s  the sparkle fades in beside the bell
//   3.1 s  the whole splash fades out (0.4 s) and is removed
//
// A click or any key skips it. With Reduce Motion on, the still logo shows
// briefly and fades. The app underneath loads meanwhile, so the splash adds
// no wait of its own. It's purely visual: if anything here fails, the splash
// is removed and the app carries on.
//
// window.splashDone resolves once the app can be seen and used, so nothing
// pops up over the splash (the calendar login window waits for it).

(function () {
  let resolveDone;
  window.splashDone = new Promise((r) => (resolveDone = r));

  const splash = document.getElementById("splash");
  // Reloading the window (Change school) doesn't replay the splash.
  let replay = true;
  try {
    replay = sessionStorage.getItem("bellforge-splash-shown") !== "1";
    sessionStorage.setItem("bellforge-splash-shown", "1");
  } catch {}
  if (!splash || !replay) {
    if (splash) splash.remove();
    resolveDone();
    return;
  }
  const rest = [...document.body.children].filter((el) => el !== splash && el.tagName !== "SCRIPT");

  const TOTAL = 3500;
  const FADE_AT = 3100;
  const at = (ms) => ms / TOTAL;
  let finished = false;

  // Keep keyboard focus out of the app until it can be seen.
  rest.forEach((el) => (el.inert = true));

  function finish(fadeMs = TOTAL - FADE_AT) {
    if (finished) return;
    finished = true;
    window.removeEventListener("keydown", skip, true);
    splash.removeEventListener("pointerdown", skip);
    rest.forEach((el) => (el.inert = false));
    resolveDone();
    const fade = splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeMs, easing: "ease-out", fill: "forwards" });
    fade.finished.catch(() => {}).then(() => splash.remove());
  }

  function skip(e) {
    if (e.type === "keydown") e.preventDefault();
    finish(150);
  }
  window.addEventListener("keydown", skip, true);
  splash.addEventListener("pointerdown", skip);

  // Never let the splash outstay its welcome, whatever happens below.
  setTimeout(() => finish(), TOTAL + 500);

  function play() {
    if (finished) return;
    const q = (s) => splash.querySelector(s);
    const lockup = q(".splash-lockup");
    const bell = q(".splash-bell");
    const body = q(".splash-bell-body");
    const clapper = q(".splash-clapper");
    const star = q(".splash-star");
    const word = q(".splash-word");
    const spark = q(".splash-spark");

    const opts = { duration: TOTAL, fill: "both", easing: "linear" };
    const anim = (el, frames) => el.animate(frames, opts);

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      splash.classList.add("still");
      setTimeout(() => finish(400), 600);
      return;
    }

    // How far the bell travels: from centered on its own to its place in
    // the finished logo.
    const shift = (word.offsetWidth + parseFloat(getComputedStyle(lockup).columnGap)) / 2;
    const drop = "cubic-bezier(.3,1.4,.5,1)";
    const push = "cubic-bezier(.25,.9,.3,1)";

    anim(bell, [
      { transform: `translate(${shift}px, -60px)`, opacity: 0, offset: 0, easing: drop },
      { transform: `translate(${shift}px, 0)`, opacity: 1, offset: at(600) },
      { transform: `translate(${shift}px, 0)`, offset: at(1400), easing: push },
      { transform: "translate(0, 0)", offset: at(2300) },
      { transform: "translate(0, 0)", offset: 1 },
    ]);

    // Two swings that die away; the clapper swings further than the bell.
    const angles = [0, 0, 14, -11, 7, -3, 0, 0];
    const times = [0, 600, 760, 940, 1110, 1260, 1400, TOTAL];
    const swing = (k) => angles.map((r, i) => ({ transform: `rotate(${r * k}deg)`, offset: at(times[i]), easing: "ease-in-out" }));
    anim(body, swing(1));
    anim(clapper, swing(1.5));

    // The wordmark slides out from behind the bell. Its visible right edge
    // starts exactly at the bell's rim, and the spark rides that edge, so it
    // reads as the spark pushing the word along.
    const hidden = `inset(-20% 0 -20% ${shift * 2}px)`;
    const shown = "inset(-20% 0 -20% 0px)";
    anim(word, [
      { transform: `translateX(${-shift}px)`, clipPath: hidden, offset: 0 },
      { transform: `translateX(${-shift}px)`, clipPath: hidden, offset: at(1400), easing: push },
      { transform: "translateX(0)", clipPath: shown, offset: at(2300) },
      { transform: "translateX(0)", clipPath: shown, offset: 1 },
    ]);

    const endX = word.offsetLeft + word.offsetWidth;
    anim(spark, [
      { transform: `translateX(${endX - shift}px) scale(0)`, opacity: 0, offset: 0 },
      { transform: `translateX(${endX - shift}px) scale(0)`, opacity: 0, offset: at(1250), easing: "cubic-bezier(.3,1.6,.5,1)" },
      { transform: `translateX(${endX - shift}px) scale(1.3)`, opacity: 1, offset: at(1400), easing: push },
      { transform: `translateX(${endX}px) scale(.9)`, opacity: 1, offset: at(2300) },
      { transform: `translateX(${endX + 8}px) scale(0)`, opacity: 0, offset: at(2500) },
      { transform: `translateX(${endX + 8}px) scale(0)`, opacity: 0, offset: 1 },
    ]);

    anim(star, [
      { opacity: 0, transform: "scale(.4) rotate(-45deg)", offset: 0 },
      { opacity: 0, transform: "scale(.4) rotate(-45deg)", offset: at(2300), easing: "cubic-bezier(.3,1.5,.5,1)" },
      { opacity: 1, transform: "scale(1) rotate(0deg)", offset: at(2800) },
      { opacity: 1, transform: "scale(1) rotate(0deg)", offset: 1 },
    ]);

    setTimeout(() => finish(), FADE_AT);
  }

  // Measure only once the wordmark has loaded, or the slide distance is 0.
  const img = splash.querySelector(".splash-word img");
  const ready = img && img.decode ? img.decode().catch(() => {}) : Promise.resolve();
  Promise.race([ready, new Promise((r) => setTimeout(r, 400))]).then(() => {
    try {
      play();
    } catch (err) {
      splash.classList.add("still");
      console.error(err);
      finish(150);
    }
  });
})();
