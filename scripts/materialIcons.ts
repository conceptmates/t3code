/**
 * Build-time reader for the upstream `material-icon-theme` package. Shared by
 * the web generator and the mobile rasterizer so both surfaces resolve a path
 * to the same icon.
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { generateManifest } from "material-icon-theme";

const require = NodeModule.createRequire(import.meta.url);

export const MATERIAL_ICON_THEME_VERSION: string =
  require("material-icon-theme/package.json").version;

/** Symbol ids are namespaced so they cannot collide with Pierre's built-in sprite. */
export function materialSymbolId(iconName: string): string {
  return `mi-${iconName}`;
}

/**
 * Upstream art reuses short gradient and clip-path ids (`a`, `i`) per file.
 * Merging those files into one sprite would make every `url(#a)` resolve to
 * whichever icon parsed last, so every internal id is prefixed per icon.
 */
function namespaceInternalIds(body: string, iconName: string): string {
  const prefix = `${iconName}__`;
  return body
    .replace(/\bid="([^"]+)"/g, (_match, id: string) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_match, id: string) => `url(#${prefix}${id})`)
    .replace(
      /\b(xlink:href|href)="#([^"]+)"/g,
      (_match, attribute: string, id: string) => `${attribute}="#${prefix}${id}"`,
    );
}

/**
 * Presentation attributes on the source root that the children inherit. The
 * root `<svg>` is dropped when the icon becomes a `<symbol>`, and losing
 * `fill="none"` there turns an icon's transparent bounding-box path into a
 * solid square, so these ride along onto the symbol.
 */
const INHERITED_ROOT_ATTRIBUTES = new Set([
  "clip-rule",
  "color",
  "fill",
  "fill-opacity",
  "fill-rule",
  "opacity",
  "stroke",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-width",
]);

function toSymbol(iconName: string, svg: string): string {
  const rootTag = /<svg([^>]*)>/.exec(svg)?.[1] ?? "";
  const viewBox = /viewBox="([^"]+)"/.exec(rootTag)?.[1] ?? "0 0 24 24";
  const inherited = [...rootTag.matchAll(/([a-z-]+)="([^"]*)"/g)]
    .filter((match) => INHERITED_ROOT_ATTRIBUTES.has(match[1] ?? ""))
    .map((match) => ` ${match[1]}="${match[2]}"`)
    .join("");
  const body = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();
  return `<symbol id="${materialSymbolId(iconName)}" viewBox="${viewBox}"${inherited}>${namespaceInternalIds(body, iconName)}</symbol>`;
}

/**
 * Artwork upstream ships but never maps to a filename, which T3 maps itself in
 * `apps/web/src/pierre-icons.ts`. Only referenced icons enter the sprite, so
 * these have to be named explicitly.
 */
const EXTRA_ICONS = ["claude"] as const;

export interface MaterialIconData {
  /** A single `<svg>` holding one `<symbol>` per referenced icon. */
  readonly sprite: string;
  /** Raw upstream SVG per icon name, for surfaces that cannot use a sprite. */
  readonly iconSvgById: Readonly<Record<string, string>>;
  readonly byFileName: Readonly<Record<string, string>>;
  readonly byFileExtension: Readonly<Record<string, string>>;
  readonly byFolderName: Readonly<Record<string, string>>;
  readonly defaultFileIcon: string;
  readonly defaultFolderIcon: string;
  readonly rootFolderIcon: string;
}

export function buildMaterialIconData(): MaterialIconData {
  const manifest = generateManifest();
  const definitions = manifest.iconDefinitions ?? {};
  // `iconPath` values are written relative to the package's `dist` directory.
  const manifestDirectory = NodePath.join(
    NodePath.dirname(require.resolve("material-icon-theme/package.json")),
    "dist",
  );

  const iconSvgById: Record<string, string> = {};
  const readIcon = (iconName: string): string => {
    const cached = iconSvgById[iconName];
    if (cached !== undefined) return cached;
    const iconPath = definitions[iconName]?.iconPath;
    if (iconPath === undefined) {
      throw new Error(`material-icon-theme has no definition for "${iconName}"`);
    }
    const svg = NodeFS.readFileSync(NodePath.resolve(manifestDirectory, iconPath), "utf8");
    iconSvgById[iconName] = svg;
    return svg;
  };

  // Folders only need the closed glyph: the tree lib renders directory rows as
  // chevron-only, so an expanded folder icon has nowhere to appear.
  const rules = {
    byFileName: manifest.fileNames ?? {},
    byFileExtension: manifest.fileExtensions ?? {},
    byFolderName: manifest.folderNames ?? {},
  };
  const defaultFileIcon = manifest.file ?? "file";
  const defaultFolderIcon = manifest.folder ?? "folder";
  const rootFolderIcon = manifest.rootFolder ?? defaultFolderIcon;

  const referenced = new Set<string>([
    defaultFileIcon,
    defaultFolderIcon,
    rootFolderIcon,
    ...EXTRA_ICONS,
  ]);
  for (const record of Object.values(rules)) {
    for (const iconName of Object.values(record)) referenced.add(iconName);
  }

  const symbols: string[] = [];
  for (const iconName of [...referenced].sort()) {
    symbols.push(toSymbol(iconName, readIcon(iconName)));
  }

  const toSymbolIds = (record: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(record).map(([key, iconName]) => [
        key.toLowerCase(),
        materialSymbolId(iconName),
      ]),
    );

  return {
    sprite: `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">${symbols.join("")}</svg>`,
    iconSvgById,
    byFileName: toSymbolIds(rules.byFileName),
    byFileExtension: toSymbolIds(rules.byFileExtension),
    byFolderName: toSymbolIds(rules.byFolderName),
    defaultFileIcon: materialSymbolId(defaultFileIcon),
    defaultFolderIcon: materialSymbolId(defaultFolderIcon),
    rootFolderIcon: materialSymbolId(rootFolderIcon),
  };
}
