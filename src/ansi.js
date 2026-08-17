// Minimal ANSI SGR parser: turns a log line into styled segments so the log
// pane shows colour instead of raw escape sequences.

const ESC = String.fromCharCode(27);

// Any CSI/OSC sequence. We interpret the SGR ones (ending in `m`) and drop
// the rest (cursor moves, erase-line, window titles) rather than printing them.
const ANSI_RE = new RegExp(
  `${ESC}\\[[0-9;?]*[a-zA-Z]|${ESC}\\][^${ESC}\\u0007]*(?:\\u0007|${ESC}\\\\)|${ESC}[()][0-9A-B]`,
  'g'
);

const BASE = [
  '#2e3440', '#e06c75', '#98c379', '#e5c07b',
  '#61afef', '#c678dd', '#56b6c2', '#c8ccd4',
];
const BRIGHT = [
  '#5c6370', '#ff7b86', '#b5e890', '#ffd68a',
  '#7cc5ff', '#dda0f0', '#7fdbe4', '#ffffff',
];

/** xterm 256-colour cube to hex. */
function xterm256(n) {
  if (n < 8) return BASE[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n < 232) {
    const i = n - 16;
    const level = (v) => (v === 0 ? 0 : 55 + v * 40);
    const r = level(Math.floor(i / 36));
    const g = level(Math.floor((i % 36) / 6));
    const b = level(i % 6);
    return `rgb(${r},${g},${b})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

const emptyStyle = () => ({
  color: null, background: null, bold: false, dim: false, italic: false, underline: false, inverse: false,
});

function applySgr(style, codes) {
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (Number.isNaN(c)) continue;
    if (c === 0) Object.assign(style, emptyStyle());
    else if (c === 1) style.bold = true;
    else if (c === 2) style.dim = true;
    else if (c === 3) style.italic = true;
    else if (c === 4) style.underline = true;
    else if (c === 7) style.inverse = true;
    else if (c === 22) { style.bold = false; style.dim = false; }
    else if (c === 23) style.italic = false;
    else if (c === 24) style.underline = false;
    else if (c === 27) style.inverse = false;
    else if (c >= 30 && c <= 37) style.color = BASE[c - 30];
    else if (c >= 90 && c <= 97) style.color = BRIGHT[c - 90];
    else if (c >= 40 && c <= 47) style.background = BASE[c - 40];
    else if (c >= 100 && c <= 107) style.background = BRIGHT[c - 100];
    else if (c === 39) style.color = null;
    else if (c === 49) style.background = null;
    else if (c === 38 || c === 48) {
      const target = c === 38 ? 'color' : 'background';
      if (codes[i + 1] === 5) { style[target] = xterm256(codes[i + 2]); i += 2; }
      else if (codes[i + 1] === 2) {
        style[target] = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`;
        i += 4;
      }
    }
  }
}

/**
 * @param {string} input
 * @returns {{text: string, style: object}[]}
 */
export function parseAnsi(input) {
  const text = String(input ?? '');
  if (!text.includes(ESC)) return [{ text, style: emptyStyle() }];

  const segments = [];
  const style = emptyStyle();
  let cursor = 0;
  let match;

  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), style: { ...style } });
    }
    const seq = match[0];
    if (seq.endsWith('m')) {
      const body = seq.slice(2, -1);
      applySgr(style, (body === '' ? '0' : body).split(';').map((p) => parseInt(p, 10) || 0));
    }
    cursor = match.index + seq.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), style: { ...style } });
  return segments.length ? segments : [{ text: '', style: emptyStyle() }];
}

/** Plain text with every escape removed, for copy-all. */
export function stripAnsi(input) {
  ANSI_RE.lastIndex = 0;
  return String(input ?? '').replace(ANSI_RE, '');
}

export function segmentStyle(style) {
  const css = {};
  const fg = style.inverse ? style.background || '#14161a' : style.color;
  const bg = style.inverse ? style.color || '#c8ccd4' : style.background;
  if (fg) css.color = fg;
  if (bg) css.background = bg;
  if (style.bold) css.fontWeight = 600;
  if (style.dim) css.opacity = 0.65;
  if (style.italic) css.fontStyle = 'italic';
  if (style.underline) css.textDecoration = 'underline';
  return css;
}
