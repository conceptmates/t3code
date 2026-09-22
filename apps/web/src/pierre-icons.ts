import { getBuiltInSpriteSheet, type FileTreeIcons } from "@pierre/trees";

import {
  MATERIAL_DEFAULT_FILE_ICON,
  MATERIAL_DEFAULT_FOLDER_ICON,
  MATERIAL_ICON_BY_FILE_EXTENSION,
  MATERIAL_ICON_BY_FILE_NAME,
  MATERIAL_ICON_BY_FOLDER_NAME,
  MATERIAL_ICON_SPRITE,
} from "./materialIcons.generated";

export interface PierreIconResolution {
  /** A `<symbol>` id in the sprite, usable as `<use href="#name">`. */
  name: string;
}

const PIERRE_ICON_SPRITE_ID = "t3code-pierre-file-icon-sprite";

/**
 * Filenames upstream leaves on the generic file icon but that carry real
 * weight in agent repositories. Values must name icons the generator was told
 * to keep (see `EXTRA_ICONS` in `scripts/materialIcons.ts`) or ones some other
 * rule already pulls into the sprite.
 */
const T3_ICON_BY_FILE_NAME: Record<string, string> = {
  "claude.md": "mi-claude",
  ".claude.md": "mi-claude",
};

/**
 * Material Icon Theme supplies both the artwork and the filename, extension,
 * and folder rules; `scripts/generate-material-icons.ts` flattens them into
 * `materialIcons.generated.ts`.
 *
 * `set: "none"` keeps Pierre's chevron, dot, and lock glyphs (the lib falls
 * back to its minimal sheet) while switching off its own file-type icons, so
 * one visual language covers every row. Colors are baked into the artwork,
 * which is why nothing here tints by token.
 *
 * `byFolderName` and the `file-tree-icon-folder` slot come from our patch in
 * `patches/@pierre__trees@1.0.0-beta.4.patch`: upstream hardcodes a chevron for
 * directory rows and never passes the row's path to the resolver, so folder art
 * has no way in. The patch splits the chevron and the entry glyph into two
 * lanes; re-apply it when the dependency moves.
 */
export const T3_PIERRE_ICONS = {
  set: "none",
  colored: false,
  spriteSheet: MATERIAL_ICON_SPRITE,
  // Entries that match no rule still need a glyph, and Pierre's generic ones
  // are from the set we just turned off.
  remap: {
    "file-tree-icon-file": MATERIAL_DEFAULT_FILE_ICON,
    "file-tree-icon-folder": MATERIAL_DEFAULT_FOLDER_ICON,
  },
  byFileName: { ...MATERIAL_ICON_BY_FILE_NAME, ...T3_ICON_BY_FILE_NAME },
  byFileExtension: MATERIAL_ICON_BY_FILE_EXTENSION,
  byFolderName: MATERIAL_ICON_BY_FOLDER_NAME,
} satisfies FileTreeIcons;

/** Desktop set kept as an alias: the icon cover is identical on all surfaces. */
export const T3_DESKTOP_PIERRE_ICONS = T3_PIERRE_ICONS;

export function pierreIconsForPlatform(_isDesktop: boolean): FileTreeIcons {
  return T3_PIERRE_ICONS;
}

const LANGUAGE_EXTENSION_ALIASES: Record<string, string> = {
  bash: "sh",
  csharp: "cs",
  dockerfile: "dockerfile",
  javascript: "js",
  jsx: "jsx",
  markdown: "md",
  mdx: "mdx",
  plaintext: "txt",
  python: "py",
  ruby: "rb",
  rust: "rs",
  shell: "sh",
  shellscript: "sh",
  swift: "swift",
  typescript: "ts",
  tsx: "tsx",
  yaml: "yml",
};

export function basenameOfPath(pathValue: string): string {
  const slashIndex = pathValue.lastIndexOf("/");
  return slashIndex === -1 ? pathValue : pathValue.slice(slashIndex + 1);
}

export function inferEntryKindFromPath(pathValue: string): "file" | "directory" {
  const base = basenameOfPath(pathValue);
  if (base.startsWith(".") && !base.slice(1).includes(".")) return "directory";
  return base.includes(".") ? "file" : "directory";
}

export function syntheticFileNameForLanguageId(languageId: string): string {
  const normalized = languageId.toLowerCase();
  return `file.${LANGUAGE_EXTENSION_ALIASES[normalized] ?? normalized}`;
}

/**
 * Mirrors Pierre's own lookup order so our chrome and the tree rows agree:
 * exact basename first, then progressively shorter extensions
 * ("component.spec.ts" tries "spec.ts" before "ts").
 */
function resolveFileSymbol(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  const exact = T3_ICON_BY_FILE_NAME[lower] ?? MATERIAL_ICON_BY_FILE_NAME[lower];
  if (exact) return exact;
  const segments = lower.split(".");
  for (let index = 1; index < segments.length; index += 1) {
    const match = MATERIAL_ICON_BY_FILE_EXTENSION[segments.slice(index).join(".")];
    if (match) return match;
  }
  return null;
}

export function resolvePierreIconForEntry(
  pathValue: string,
  kind: "file" | "directory",
  _isDesktop = false,
): PierreIconResolution {
  const base = basenameOfPath(pathValue).toLowerCase();
  if (kind === "directory") {
    return { name: MATERIAL_ICON_BY_FOLDER_NAME[base] ?? MATERIAL_DEFAULT_FOLDER_ICON };
  }
  return { name: resolveFileSymbol(base) ?? MATERIAL_DEFAULT_FILE_ICON };
}

/** False when a name only reaches the generic file glyph, so callers can hide it. */
export function hasSpecificPierreIconForFileName(fileName: string, _isDesktop = false): boolean {
  return resolveFileSymbol(basenameOfPath(fileName)) !== null;
}

export function ensurePierreIconSprite(): void {
  if (typeof document === "undefined" || document.getElementById(PIERRE_ICON_SPRITE_ID)) return;
  const container = document.createElement("div");
  container.id = PIERRE_ICON_SPRITE_ID;
  container.setAttribute("aria-hidden", "true");
  container.style.position = "absolute";
  container.style.width = "0";
  container.style.height = "0";
  container.style.overflow = "hidden";
  container.style.pointerEvents = "none";
  // The minimal sheet carries the chevron, dot, and lock slots our own chrome
  // shares with the tree rows.
  container.innerHTML = `${getBuiltInSpriteSheet("minimal")}${MATERIAL_ICON_SPRITE}`;
  document.body.prepend(container);
}
