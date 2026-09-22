/**
 * Artwork for the macOS Touch Bar, drawn as SVG and rasterized here.
 *
 * The main process cannot render SVG and the app's icons are React components,
 * so the renderer draws both the brand glyphs and the popover rows and hands
 * the bytes over. Everything is drawn at 2x for the Touch Bar's display.
 */

const SCALE = 2;

/** 18pt square, the size a Touch Bar button gives an icon. */
const GLYPH_POINTS = 18;

/**
 * Brand glyphs, lifted from the app's own `Icons.tsx` so the strip and the app
 * cannot drift apart. Each colour is that icon's dark-appearance fill: the
 * Touch Bar is always a dark surface, whatever the window's appearance is.
 */
const PROVIDER_GLYPHS: Record<
  string,
  { readonly viewBox: string; readonly path: string; readonly fill: string }
> = {
  claudeAgent: {
    viewBox: "0 0 256 257",
    fill: "#d97757",
    path: "m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z",
  },
  codex: {
    viewBox: "0 0 256 260",
    fill: "#ffffff",
    path: "M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z",
  },
  cursor: {
    viewBox: "0 0 466.73 532.09",
    fill: "#edecec",
    path: "M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z",
  },
  grok: {
    viewBox: "0 0 24 24",
    fill: "#f5f5f5",
    path: "M9.26905 15.284L17.2479 9.36086C17.6391 9.07047 18.1981 9.18374 18.3845 9.63478C19.3655 12.0135 18.9272 14.8721 16.9755 16.8349C15.0238 18.7976 12.3082 19.228 9.8261 18.2477L7.1146 19.5102C11.0037 22.1834 15.7263 21.5223 18.6774 18.5525C21.0182 16.1985 21.7432 12.9897 21.0653 10.0961L21.0714 10.1023C20.0884 5.85143 21.3131 4.15233 23.8218 0.677913C23.8812 0.595532 23.9406 0.513151 24 0.428711L20.6987 3.74866V3.73836L9.267 15.2861M7.62249 16.7237C4.83113 14.0422 5.3124 9.89222 7.69417 7.49905C9.45541 5.72786 12.341 5.00497 14.86 6.06768L17.5653 4.81138C17.0779 4.45714 16.4533 4.07613 15.7365 3.80839C12.4966 2.46764 8.6178 3.13492 5.98413 5.78141C3.45081 8.32904 2.65415 12.2463 4.02219 15.5889C5.04412 18.0871 3.36889 19.8541 1.68137 21.6377C1.08337 22.2699 0.483318 22.9022 0 23.5716L7.62045 16.7257Z",
  },
  opencode: {
    viewBox: "0 0 32 40",
    fill: "#f1ecec",
    path: "M24 8H8V32H24V8ZM32 40H0V0H32V40Z",
  },
};

/**
 * The strip's own action glyphs, drawn here rather than pulled from macOS.
 *
 * Apple ships no list of `NSTouchBar*` template names a compiler can check,
 * and a name this system does not have renders as nothing. Drawing them keeps
 * every icon on the strip at one size and weight, which is what the brand
 * glyphs beside them need anyway.
 */
const ACTION_GLYPHS: Record<string, string> = {
  run: '<path fill="#ffffff" d="M8.5 5.2v13.6L19 12z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="#ffffff"/>',
  // Four project-and-thread controls sit side by side, so each gets its own
  // silhouette: a grid picks one of many, a funnel narrows a list, folder-plus
  // and the pencil match what the sidebar already shows for the same actions.
  "switch-project":
    '<rect x="3.6" y="3.6" width="7.4" height="7.4" rx="1.8" fill="#ffffff"/>' +
    '<rect x="13" y="3.6" width="7.4" height="7.4" rx="1.8" fill="#ffffff" opacity="0.55"/>' +
    '<rect x="3.6" y="13" width="7.4" height="7.4" rx="1.8" fill="#ffffff" opacity="0.55"/>' +
    '<rect x="13" y="13" width="7.4" height="7.4" rx="1.8" fill="#ffffff" opacity="0.55"/>',
  "filter-project":
    '<path fill="#ffffff" d="M3.4 5.2h17.2a.9.9 0 0 1 .68 1.49l-6.2 7.1v5.3a.9.9 0 0 1-1.3.8l-3-1.5a.9.9 0 0 1-.5-.8v-3.8l-6.2-7.1a.9.9 0 0 1 .68-1.49z"/>',
  "new-project":
    '<path d="M3.2 6.4a1.8 1.8 0 0 1 1.8-1.8h3.6l1.8 2.2h7.6a1.8 1.8 0 0 1 1.8 1.8v8.8a1.8 1.8 0 0 1-1.8 1.8H5a1.8 1.8 0 0 1-1.8-1.8z" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M12 10.6v5M9.5 13.1h5" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/>',
  // The filled panel sits on the RIGHT, mirroring where the drawer opens.
  "right-panel":
    '<rect x="3.2" y="5" width="17.6" height="14" rx="2.2" fill="none" stroke="#ffffff" stroke-width="1.7"/>' +
    '<path d="M14.4 5v14" stroke="#ffffff" stroke-width="1.7"/>' +
    '<rect x="15.3" y="5.9" width="4.6" height="12.2" rx="1.3" fill="#ffffff" opacity="0.55"/>',
  terminal:
    '<rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.2" fill="none" stroke="#ffffff" stroke-width="1.7"/>' +
    '<path d="M7.1 9.4l3.1 2.6-3.1 2.6" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M12.4 15h4.6" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/>',
  "new-thread":
    '<path d="M4.6 19.4h14.8" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M5.4 15.2 15.6 5a1.9 1.9 0 0 1 2.7 2.7L8.1 17.9l-3.4.7z" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linejoin="round"/>',
};

/**
 * Tailwind's 400 ramp for each project colour, as literal hex.
 *
 * The app stores these as class names, which SVG cannot read, and the Touch
 * Bar is always a dark surface — so the dark-appearance step is the right one
 * to bake in.
 */
const PROJECT_COLORS: Record<string, string> = {
  gray: "#9ca3af",
  red: "#f87171",
  orange: "#fb923c",
  amber: "#fbbf24",
  yellow: "#facc15",
  lime: "#a3e635",
  green: "#4ade80",
  emerald: "#34d399",
  teal: "#2dd4bf",
  cyan: "#22d3ee",
  sky: "#38bdf8",
  blue: "#60a5fa",
  indigo: "#818cf8",
  violet: "#a78bfa",
  purple: "#c084fc",
  fuchsia: "#e879f9",
  pink: "#f472b6",
  rose: "#fb7185",
};

export const projectIconKey = (projectKey: string): string => `project:${projectKey}`;

export interface TouchBarProjectIcon {
  /** An emoji is drawn as-is; a monogram is drawn on a coloured tile. */
  readonly kind: "emoji" | "monogram";
  readonly text: string;
  readonly color: string;
}

/**
 * Reduce a project's saved icon to something drawable at 18pt.
 *
 * Emoji and monograms survive intact. A lucide icon does not: its path data
 * lives inside a React component and cannot be read into an SVG string here,
 * so it degrades to a monogram in the icon's own colour — which keeps the
 * colour the user chose, the part that actually distinguishes rows in a list.
 */
export function resolveProjectIcon(
  projectIcon:
    | {
        readonly kind: string;
        readonly emoji?: string;
        readonly text?: string;
        readonly color?: string;
      }
    | null
    | undefined,
  displayName: string,
): TouchBarProjectIcon {
  const initial = [...displayName.trim()][0]?.toUpperCase() ?? "?";
  if (projectIcon?.kind === "emoji" && projectIcon.emoji) {
    return { kind: "emoji", text: projectIcon.emoji, color: "#ffffff" };
  }
  const color = PROJECT_COLORS[projectIcon?.color ?? ""] ?? "#8e8e93";
  if (projectIcon?.kind === "monogram" && projectIcon.text) {
    return { kind: "monogram", text: [...projectIcon.text][0]?.toUpperCase() ?? initial, color };
  }
  return { kind: "monogram", text: initial, color };
}

export const actionIconKey = (action: string): string => `action:${action}`;
export const providerChipKey = (instanceId: string): string => `chip:${instanceId}`;

/** The accent each provider's quota bar is filled with. */
export function providerAccentColor(driverKind: string, override?: string | undefined): string {
  return override ?? PROVIDER_GLYPHS[driverKind]?.fill ?? "#8e8e93";
}

export const providerIconKey = (driverKind: string): string => `provider:${driverKind}`;
export const providerRowKey = (instanceId: string): string => `row:${instanceId}`;

/** Every driver the strip can draw a glyph for. */
export const drawableDriverKinds = (): readonly string[] => Object.keys(PROVIDER_GLYPHS);

function glyphSvg(driverKind: string): string | null {
  const glyph = PROVIDER_GLYPHS[driverKind];
  if (glyph === undefined) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${glyph.viewBox}" width="${GLYPH_POINTS * SCALE}" height="${GLYPH_POINTS * SCALE}"><path fill="${glyph.fill}" d="${glyph.path}"/></svg>`;
}

// The strip is a dark surface whatever the window's appearance, so these are
// fixed rather than semantic. Secondary text is #FFFFFF at 62%, which lands
// near 5.4:1 on the strip's own background — above the 4.5:1 floor for 11pt.
const ROW_TEXT = "rgba(255,255,255,0.92)";
const ROW_SECONDARY = "rgba(255,255,255,0.62)";
const ROW_TRACK = "rgba(255,255,255,0.18)";
const ROW_OVER_LIMIT = "#ff6961";

const ROW_HEIGHT = 30;
const ROW_PAD = 8;
const GLYPH_SIZE = 16;
const BAR_WIDTH = 54;
const BAR_HEIGHT = 4;
const OVER_LIMIT_PERCENT = 90;

export interface TouchBarRowWindow {
  /** `5h` or `Wk`. */
  readonly caption: string;
  readonly usedPercent: number;
  readonly countdown: string | null;
}

export interface TouchBarRowSpec {
  readonly driverKind: string;
  readonly accentColor: string;
  readonly selected: boolean;
  readonly windows: readonly TouchBarRowWindow[];
}

const escapeText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * One popover row: the brand glyph, then a captioned bar, percentage and
 * countdown per quota window. Selection is drawn inside the row — a leading
 * accent rule — rather than as a button background, so the text contrast does
 * not change with the provider's colour.
 */
export function rowSvg(spec: TouchBarRowSpec): string {
  const glyph = PROVIDER_GLYPHS[spec.driverKind];
  const parts: string[] = [];
  let x = ROW_PAD;

  if (spec.selected) {
    parts.push(
      `<rect x="0" y="6" width="3" height="${ROW_HEIGHT - 12}" rx="1.5" fill="${spec.accentColor}"/>`,
    );
    x += 4;
  }

  if (glyph !== undefined) {
    const y = (ROW_HEIGHT - GLYPH_SIZE) / 2;
    parts.push(
      `<g transform="translate(${x} ${y})" opacity="${spec.selected ? 1 : 0.75}">` +
        `<svg viewBox="${glyph.viewBox}" width="${GLYPH_SIZE}" height="${GLYPH_SIZE}"><path fill="${glyph.fill}" d="${glyph.path}"/></svg>` +
        `</g>`,
    );
    x += GLYPH_SIZE + 10;
  }

  for (const window of spec.windows) {
    const used = Math.max(0, Math.min(100, window.usedPercent));
    const fill = used >= OVER_LIMIT_PERCENT ? ROW_OVER_LIMIT : spec.accentColor;
    parts.push(
      `<text x="${x}" y="19" font-family="-apple-system, system-ui" font-size="11" fill="${ROW_SECONDARY}">${escapeText(window.caption)}</text>`,
    );
    x += window.caption.length * 7 + 4;
    const barY = (ROW_HEIGHT - BAR_HEIGHT) / 2;
    parts.push(
      `<rect x="${x}" y="${barY}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}" fill="${ROW_TRACK}"/>`,
    );
    if (used > 0) {
      const filled = Math.max(BAR_HEIGHT, (BAR_WIDTH * used) / 100);
      parts.push(
        `<rect x="${x}" y="${barY}" width="${filled}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}" fill="${fill}"/>`,
      );
    }
    x += BAR_WIDTH + 6;
    parts.push(
      `<text x="${x}" y="19" font-family="-apple-system, system-ui" font-size="11" font-variant-numeric="tabular-nums" fill="${ROW_TEXT}">${Math.round(used)}%</text>`,
    );
    x += 26;
    if (window.countdown !== null) {
      parts.push(
        `<text x="${x}" y="19" font-family="-apple-system, system-ui" font-size="11" fill="${ROW_SECONDARY}">${escapeText(window.countdown)}</text>`,
      );
      x += window.countdown.length * 6 + 10;
    } else {
      x += 6;
    }
  }

  const width = Math.ceil(x + ROW_PAD);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${ROW_HEIGHT * SCALE}" viewBox="0 0 ${width} ${ROW_HEIGHT}">${parts.join("")}</svg>`;
}

/** Rasterize an SVG string to PNG bytes. Resolves to null if the browser refuses it. */
export async function rasterizeSvg(svg: string): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = new Image();
  const loaded = await new Promise<boolean>((resolve) => {
    image.addEventListener("load", () => resolve(true), { once: true });
    image.addEventListener("error", () => resolve(false), { once: true });
    image.src = url;
  });
  if (!loaded || image.width === 0 || image.height === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.drawImage(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (blob === null) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/** The brand glyphs, drawn once. Drivers without artwork are simply absent. */
export async function renderProviderGlyphs(
  driverKinds: readonly string[],
): Promise<Record<string, Uint8Array>> {
  const rendered: Record<string, Uint8Array> = {};
  for (const driverKind of driverKinds) {
    const svg = glyphSvg(driverKind);
    if (svg === null) continue;
    const bytes = await rasterizeSvg(svg);
    if (bytes !== null) rendered[providerIconKey(driverKind)] = bytes;
  }
  return rendered;
}

export async function renderProviderRow(spec: TouchBarRowSpec): Promise<Uint8Array | null> {
  return rasterizeSvg(rowSvg(spec));
}

const CHIP_HEIGHT = 26;
const CHIP_PAD = 6;
const CHIP_GAP = 5;
const CHIP_TEXT_WIDTH = 30;

export interface TouchBarChipSpec {
  readonly driverKind: string;
  /** The bare percentage, e.g. `62%`. */
  readonly label: string;
}

/**
 * A strip chip: the brand glyph and the percentage in one image.
 *
 * They have to share an image because a Touch Bar popover collapses to either
 * its image or its label, never both — an icon set alongside a label silently
 * hides the label.
 */
export function chipSvg(spec: TouchBarChipSpec): string {
  const glyph = PROVIDER_GLYPHS[spec.driverKind];
  const glyphWidth = glyph === undefined ? 0 : GLYPH_SIZE + CHIP_GAP;
  const width = CHIP_PAD * 2 + glyphWidth + CHIP_TEXT_WIDTH;
  const parts: string[] = [];
  if (glyph !== undefined) {
    parts.push(
      `<g transform="translate(${CHIP_PAD} ${(CHIP_HEIGHT - GLYPH_SIZE) / 2})">` +
        `<svg viewBox="${glyph.viewBox}" width="${GLYPH_SIZE}" height="${GLYPH_SIZE}"><path fill="${glyph.fill}" d="${glyph.path}"/></svg>` +
        `</g>`,
    );
  }
  parts.push(
    `<text x="${CHIP_PAD + glyphWidth}" y="${CHIP_HEIGHT / 2 + 4}" font-family="-apple-system, system-ui" font-size="12" font-variant-numeric="tabular-nums" fill="${ROW_TEXT}">${escapeText(spec.label)}</text>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${CHIP_HEIGHT * SCALE}" viewBox="0 0 ${width} ${CHIP_HEIGHT}">${parts.join("")}</svg>`;
}

/** The strip's action glyphs, drawn once. */
export async function renderActionGlyphs(): Promise<{ key: string; bytes: Uint8Array }[]> {
  const rendered: { key: string; bytes: Uint8Array }[] = [];
  for (const [action, inner] of Object.entries(ACTION_GLYPHS)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${GLYPH_POINTS * SCALE}" height="${GLYPH_POINTS * SCALE}">${inner}</svg>`;
    const bytes = await rasterizeSvg(svg);
    if (bytes !== null) rendered.push({ key: actionIconKey(action), bytes });
  }
  return rendered;
}

const PROJECT_ROW_HEIGHT = 30;
const PROJECT_TILE = 18;

/** One row of the project switcher: the project's icon, then its name. */
export function projectRowSvg(spec: {
  readonly icon: TouchBarProjectIcon;
  readonly label: string;
}): string {
  const x = ROW_PAD;
  const tileY = (PROJECT_ROW_HEIGHT - PROJECT_TILE) / 2;
  const parts: string[] = [];
  if (spec.icon.kind === "emoji") {
    parts.push(
      `<text x="${x}" y="${PROJECT_ROW_HEIGHT / 2 + 6}" font-size="16">${escapeText(spec.icon.text)}</text>`,
    );
  } else {
    parts.push(
      `<rect x="${x}" y="${tileY}" width="${PROJECT_TILE}" height="${PROJECT_TILE}" rx="5" fill="${spec.icon.color}"/>`,
      `<text x="${x + PROJECT_TILE / 2}" y="${PROJECT_ROW_HEIGHT / 2 + 4.5}" text-anchor="middle" font-family="-apple-system, system-ui" font-size="12" font-weight="600" fill="#1c1c1e">${escapeText(spec.icon.text)}</text>`,
    );
  }
  const textX = x + PROJECT_TILE + 8;
  parts.push(
    `<text x="${textX}" y="${PROJECT_ROW_HEIGHT / 2 + 4}" font-family="-apple-system, system-ui" font-size="12" fill="${ROW_TEXT}">${escapeText(spec.label)}</text>`,
  );
  // Roughly 7px per character at 12pt, plus the tile and padding.
  const width = Math.ceil(textX + spec.label.length * 7 + ROW_PAD);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${PROJECT_ROW_HEIGHT * SCALE}" viewBox="0 0 ${width} ${PROJECT_ROW_HEIGHT}">${parts.join("")}</svg>`;
}
