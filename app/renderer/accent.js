// accent.js — turns a school's accent color into the app's accent tokens.
//
// A school sets one color in school.json ("accent"), and optionally a
// second for dark mode ("accentDark"). Everything else is worked out here:
// the lighter end of the button gradient, hover shades, a link color that
// reads on the page background, and whether text on the accent should be
// white or dark. Every text pairing is held to WCAG AA (4.5:1), so a light
// school color like yellow still gets readable buttons.
//
// Before a school is chosen, styles.css uses the BellForge ember defaults.
// Lightness changes are made in OKLCH so they look even across hues.

(function () {
  const WHITE = "#ffffff";
  const INK = "#1a1a1e";
  // The page backgrounds links are read against (styles.css --bg).
  const BG_LIGHT = "#f4f4f6";
  const BG_DARK = "#17171b";
  const AA = 4.5;

  const isHex = (s) => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s.trim());

  function hexToRgb(hex) {
    const h = hex.trim().slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  function rgbToHex(rgb) {
    return "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");
  }
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  // sRGB <-> OKLab (Björn Ottosson's reference matrices).
  function toOklab(hex) {
    const [r, g, b] = hexToRgb(hex).map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }
  function fromOklab([L, A, B]) {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return rgbToHex(
      [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ].map(fromLinear)
    );
  }
  // Moves a color's lightness by delta (OKLab L runs 0 to 1).
  function shift(hex, delta) {
    const [L, A, B] = toOklab(hex);
    return fromOklab([Math.min(1, Math.max(0, L + delta)), A, B]);
  }

  // The darker of two gradient stops is the fill; the lighter stop is found
  // by lightening it as far as `want` allows while text still passes on it.
  function buttonTokens(fill, want) {
    const onAccent = contrast(WHITE, fill) >= contrast(INK, fill) ? WHITE : INK;
    // Dark text needs the fill lighter, not darker, so the stop goes the
    // other way for it.
    const dir = onAccent === WHITE ? 1 : -1;
    let stop = fill;
    for (let d = want; d > 0; d -= 0.01) {
      const candidate = shift(fill, dir * d);
      if (contrast(onAccent, candidate) >= AA) {
        stop = candidate;
        break;
      }
    }
    const hover = onAccent === WHITE ? -0.05 : 0.05;
    return { fill, stop, fillHover: shift(fill, hover), stopHover: shift(stop, hover), onAccent };
  }

  // A link color that reads on bg, as close to `hex` as possible.
  function readable(hex, bg, dir) {
    let c = hex;
    for (let i = 0; i < 60 && contrast(c, bg) < AA; i++) c = shift(c, dir * 0.01);
    return c;
  }

  function accentTokens(accent, accentDark) {
    if (!isHex(accent)) return null;
    const light = buttonTokens(accent, 0.1);
    const darkFill = isHex(accentDark) ? accentDark : shift(accent, 0.08);
    const dark = buttonTokens(darkFill, 0.08);
    // Dark-mode links sit at a fixed, comfortable lightness, then are pushed
    // further if needed.
    const [, A, B] = toOklab(darkFill);
    const darkLink = readable(fromOklab([0.72, A, B]), BG_DARK, 1);
    return {
      "--school-accent": light.fill,
      "--school-accent-2": light.stop,
      "--school-accent-hover": light.fillHover,
      "--school-accent-2-hover": light.stopHover,
      "--school-on-accent": light.onAccent,
      "--school-link": readable(accent, BG_LIGHT, -1),
      "--school-accent-dark": dark.fill,
      "--school-accent-2-dark": dark.stop,
      "--school-accent-hover-dark": dark.fillHover,
      "--school-accent-2-hover-dark": dark.stopHover,
      "--school-on-accent-dark": dark.onAccent,
      "--school-link-dark": darkLink,
    };
  }

  // Applies a school's accent, or clears it (back to BellForge's own colors)
  // when given nothing.
  function applySchoolAccent(school) {
    const root = document.documentElement.style;
    const tokens = school ? accentTokens(school.accent, school.accentDark) : null;
    for (let i = root.length - 1; i >= 0; i--) {
      if (root[i].startsWith("--school-")) root.removeProperty(root[i]);
    }
    if (tokens) for (const [name, value] of Object.entries(tokens)) root.setProperty(name, value);
  }

  const api = { accentTokens, applySchoolAccent, contrast };
  if (typeof module !== "undefined") module.exports = api;
  else window.accent = api;
})();
