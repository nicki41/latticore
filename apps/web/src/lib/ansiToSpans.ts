export interface AnsiSpan {
  text: string;
  className?: string;
}

// Minecraft/log4j only ever emits SGR (Select Graphic Rendition) color/style
// codes — no 256-color, no truecolor, no cursor movement (and the panel's
// own launch script now disables JLine's interactive terminal, which was
// the source of any cursor/prompt-redraw codes that did show up) — so this
// is a small hand-rolled parser rather than a dependency, matching this
// codebase's preference for reviewable in-house code over a low-traffic
// package (see RconClient.ts) and avoiding the common alternative's
// dangerouslySetInnerHTML for text that ultimately comes from arbitrary
// third-party plugin/mod console output.
//
// Matches any CSI sequence (ESC [ params letter), not just SGR's "m" —
// non-SGR ones (e.g. a stray cursor/mode-toggle code) are silently consumed
// rather than leaking into the rendered text as literal garbage.
// eslint-disable-next-line no-control-regex -- matching the ESC control character is the whole point
const CSI_PATTERN = /\x1b\[([0-9;?]*)([a-zA-Z])/g;

const FOREGROUND_CLASS: Record<number, string> = {
  30: "text-neutral-500",
  31: "text-red-400",
  32: "text-green-400",
  33: "text-yellow-400",
  34: "text-blue-400",
  35: "text-fuchsia-400",
  36: "text-cyan-400",
  37: "text-neutral-200",
  90: "text-neutral-500",
  91: "text-red-300",
  92: "text-green-300",
  93: "text-yellow-300",
  94: "text-blue-300",
  95: "text-fuchsia-300",
  96: "text-cyan-300",
  97: "text-white",
};

interface AnsiState {
  fg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

const RESET_STATE: AnsiState = { fg: null, bold: false, italic: false, underline: false };

function classNameFor(state: AnsiState): string | undefined {
  const classes: string[] = [];
  if (state.fg) classes.push(state.fg);
  if (state.bold) classes.push("font-bold");
  if (state.italic) classes.push("italic");
  if (state.underline) classes.push("underline");
  return classes.length ? classes.join(" ") : undefined;
}

function applySgrCodes(state: AnsiState, params: string): AnsiState {
  const codes = params
    .split(";")
    .filter(Boolean)
    .map((s) => Number(s));
  if (codes.length === 0) codes.push(0); // bare "ESC[m" means reset

  let next = state;
  for (const code of codes) {
    if (code === 0) next = { ...RESET_STATE };
    else if (code === 1) next = { ...next, bold: true };
    else if (code === 3) next = { ...next, italic: true };
    else if (code === 4) next = { ...next, underline: true };
    else if (code === 22) next = { ...next, bold: false };
    else if (code === 23) next = { ...next, italic: false };
    else if (code === 24) next = { ...next, underline: false };
    else if (code === 39) next = { ...next, fg: null };
    else if (FOREGROUND_CLASS[code]) next = { ...next, fg: FOREGROUND_CLASS[code] };
    // Unsupported codes (256-color, background, etc.) are ignored, not
    // errored on — better to under-color a line than fail to render it.
  }
  return next;
}

/** Plain-text view of a console line, escape codes removed — for search matching against what's actually visible. */
export function stripAnsiCodes(text: string): string {
  return text.replace(CSI_PATTERN, "");
}

export function ansiToSpans(text: string): AnsiSpan[] {
  if (!text.includes("\x1b")) return [{ text }]; // common case, no escape codes at all

  const spans: AnsiSpan[] = [];
  let state = RESET_STATE;
  let lastIndex = 0;

  CSI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSI_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      spans.push({ text: text.slice(lastIndex, match.index), className: classNameFor(state) });
    }
    if (match[2] === "m") state = applySgrCodes(state, match[1] ?? "");
    lastIndex = CSI_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), className: classNameFor(state) });
  }
  return spans;
}
