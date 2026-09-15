import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
  type FileTreeIcons,
  type RemappedIcon,
} from "@pierre/trees";
import { VIDEO_FILE_EXTENSIONS } from "@t3tools/shared/video";

export interface PierreIconResolution {
  name: string;
  token?: string;
}

const PIERRE_ICON_SPRITE_ID = "t3code-pierre-file-icon-sprite";

const T3_FILE_ICON_SPRITE = `
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">
  <!-- Lucide Film icon, ISC license. -->
  <symbol id="t3-file-icon-video" viewBox="0 0 24 24">
    <g fill="none" stroke="#a631be" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4" />
    </g>
  </symbol>
  <symbol id="t3-file-icon-agents" viewBox="0 0 32 32">
    <path fill="currentColor" d="M27.2 16c0-6.19-5.01-11.2-11.2-11.2C9.81 4.8 4.8 9.81 4.8 16S9.81 27.2 16 27.2c6.19 0 11.2-5.01 11.2-11.2Zm-5.6 2.1a1.4 1.4 0 1 1 0 2.8h-4.2a1.4 1.4 0 1 1 0-2.8Zm-11.2-6.8c.622-.373 1.42-.208 1.84.361l.079.119 2.1 3.5.088.171c.15.351.15.748 0 1.1l-.088.171-2.1 3.5a1.4 1.4 0 0 1-2.4-1.44L11.59 16l-1.67-2.78-.067-.127c-.302-.642-.075-1.42.547-1.79ZM30 16c0 7.73-6.27 14-14 14S2 23.73 2 16 8.27 2 16 2s14 6.27 14 14Z" />
  </symbol>
  <symbol id="t3-file-icon-pnpm" viewBox="0 0 32 32">
    <path fill="#f9ad00" d="M30 10.75h-8.749V2H30Zm-9.626 0h-8.75V2h8.75Zm-9.625 0H2V2h8.749ZM30 20.375h-8.749v-8.75H30Z" />
    <path fill="currentColor" d="M20.374 20.375h-8.75v-8.75h8.75Zm0 9.625h-8.75v-8.75h8.75ZM30 30h-8.749v-8.75H30Zm-19.251 0H2v-8.75h8.749Z" />
  </symbol>
  <!-- Material-style folder glyph (Material Icons "folder" path, Apache 2.0). -->
  <!-- Filled with currentColor so callers tint per folder name. -->
  <symbol id="t3-folder-material" viewBox="0 0 24 24">
    <path fill="currentColor" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2Z" />
  </symbol>
</svg>`;

/**
 * A resolver string entry carries no token, and an untokened resolution
 * renders default-gray: the glyph would be right but the color wrong. The
 * resolver spreads object entries through (`{...entry, remappedFrom}`), so a
 * token rides along at runtime; the lib's RemappedIcon type just doesn't
 * declare it.
 */
function tokenedIcon(name: string, token: string): RemappedIcon {
  return { name, token } as RemappedIcon;
}

/**
 * Material-style file cover for dotfiles and tool configs (VS Code style).
 * Applies on every surface — the mappings only use existing `complete`-set
 * tokens, so this is one icon family with no extra sprite weight.
 *
 * Boundary: @pierre/trees renders directory rows as chevron-only inside a
 * shadow root and exposes no folder icon slot (only file/chevron/dot/lock),
 * so per-folder glyphs cannot reach the file-tree rows without forking the
 * lib. Folders get Material colors in our own UI instead (PierreEntryIcon).
 */
const MATERIAL_ICON_BY_FILE_NAME: Record<string, RemappedIcon> = {
  ".gitignore": tokenedIcon("file-tree-builtin-git", "git"),
  ".gitattributes": tokenedIcon("file-tree-builtin-git", "git"),
  ".gitmodules": tokenedIcon("file-tree-builtin-git", "git"),
  ".cursorrules": tokenedIcon("file-tree-builtin-vscode", "vscode"),
  ".cursorignore": tokenedIcon("file-tree-builtin-vscode", "vscode"),
  ".mcp.json": tokenedIcon("file-tree-builtin-mcp", "mcp"),
  "mcp.json": tokenedIcon("file-tree-builtin-mcp", "mcp"),
  ".opencode.json": tokenedIcon("file-tree-builtin-json", "json"),
  "opencode.json": tokenedIcon("file-tree-builtin-json", "json"),
  ".cta.json": tokenedIcon("file-tree-builtin-json", "json"),
  ".npmrc": tokenedIcon("file-tree-builtin-npm", "npm"),
  ".nvmrc": tokenedIcon("file-tree-builtin-npm", "npm"),
  ".env": tokenedIcon("file-tree-builtin-database", "database"),
  ".env.example": tokenedIcon("file-tree-builtin-database", "database"),
  ".editorconfig": tokenedIcon("file-tree-builtin-text", "text"),
  Dockerfile: tokenedIcon("file-tree-builtin-docker", "docker"),
  "docker-compose.yml": tokenedIcon("file-tree-builtin-docker", "docker"),
  "docker-compose.yaml": tokenedIcon("file-tree-builtin-docker", "docker"),
  "compose.yml": tokenedIcon("file-tree-builtin-docker", "docker"),
  "compose.yaml": tokenedIcon("file-tree-builtin-docker", "docker"),
  "AGENTS.md": "t3-file-icon-agents",
  "CLAUDE.md": tokenedIcon("file-tree-builtin-claude", "claude"),
  "go.mod": tokenedIcon("file-tree-builtin-go", "go"),
  "go.sum": tokenedIcon("file-tree-builtin-go", "go"),
  "Cargo.toml": tokenedIcon("file-tree-builtin-rust", "rust"),
  "Cargo.lock": tokenedIcon("file-tree-builtin-rust", "rust"),
  "pyproject.toml": tokenedIcon("file-tree-builtin-python", "python"),
  "Makefile": tokenedIcon("file-tree-builtin-text", "text"),
  "makefile": tokenedIcon("file-tree-builtin-text", "text"),
  "GNUmakefile": tokenedIcon("file-tree-builtin-text", "text"),
};

const MATERIAL_ICON_BY_FILE_NAME_CONTAINS: Record<string, RemappedIcon> = {
  ".env.": tokenedIcon("file-tree-builtin-database", "database"),
  dockerfile: tokenedIcon("file-tree-builtin-docker", "docker"),
  "docker-compose": tokenedIcon("file-tree-builtin-docker", "docker"),
  tsconfig: tokenedIcon("file-tree-builtin-typescript", "typescript"),
  license: tokenedIcon("file-tree-builtin-text", "text"),
  "code-workspace": tokenedIcon("file-tree-builtin-vscode", "vscode"),
};

export const T3_PIERRE_ICONS = {
  set: "complete",
  colored: true,
  spriteSheet: T3_FILE_ICON_SPRITE,
  byFileName: {
    "package.json": tokenedIcon("file-tree-builtin-npm", "npm"),
    "tsconfig.json": tokenedIcon("file-tree-builtin-typescript", "typescript"),
    "agents.md": "t3-file-icon-agents",
    "pnpm-lock.yaml": "t3-file-icon-pnpm",
    "pnpm-workspace.yaml": "t3-file-icon-pnpm",
    ...MATERIAL_ICON_BY_FILE_NAME,
  },
  byFileNameContains: MATERIAL_ICON_BY_FILE_NAME_CONTAINS,
  byFileExtension: Object.fromEntries(
    VIDEO_FILE_EXTENSIONS.map((extension) => [extension, "t3-file-icon-video"]),
  ),
} satisfies FileTreeIcons;

/** Desktop set kept as an alias: the Material file cover is identical on all surfaces. */
export const T3_DESKTOP_PIERRE_ICONS = T3_PIERRE_ICONS;

export function pierreIconsForPlatform(_isDesktop: boolean): FileTreeIcons {
  return T3_PIERRE_ICONS;
}

const completeIconResolver = createFileTreeIconResolver(T3_PIERRE_ICONS);

/**
 * Material-style folder tint by exact lowercase basename: [light, dark] hex.
 * Used by PierreEntryIcon (our own UI). The file-tree rows render inside the
 * lib's shadow root as chevron-only and cannot be tinted per folder.
 */
const MATERIAL_FOLDER_COLORS: Record<string, readonly [light: string, dark: string]> = {
  ".claude": ["#d47628", "#ffa359"],
  ".codex": ["#84848a", "#adadb1"],
  ".cursor": ["#1a85d4", "#69b1ff"],
  ".github": ["#594c5b", "#79697b"],
  ".vscode": ["#1a85d4", "#69b1ff"],
  ".git": ["#ff8c5b", "#d5512f"],
};

type MaterialFolderGroup = "blue" | "green" | "gray" | "orange" | "purple" | "red" | "pink";

const MATERIAL_FOLDER_COLOR_BY_GROUP: Record<MaterialFolderGroup, readonly [light: string, dark: string]> = {
  blue: ["#1a85d4", "#69b1ff"],
  green: ["#199f43", "#5ecc71"],
  gray: ["#84848a", "#adadb1"],
  orange: ["#d47628", "#ffa359"],
  purple: ["#a631be", "#d568ea"],
  red: ["#d52c36", "#ff6762"],
  pink: ["#d32a61", "#ff678d"],
};

const MATERIAL_FOLDER_GROUP_BY_NAME: Record<string, MaterialFolderGroup> = {
  apps: "blue",
  assets: "purple",
  build: "gray",
  coverage: "gray",
  dist: "gray",
  docker: "blue",
  docs: "blue",
  e2e: "green",
  infra: "orange",
  landing: "gray",
  native: "gray",
  node_modules: "green",
  out: "gray",
  packages: "blue",
  patches: "red",
  public: "purple",
  release: "pink",
  scripts: "gray",
  src: "blue",
  static: "purple",
  test: "green",
  tests: "green",
  tools: "gray",
  userdata: "purple",
  vendor: "green",
  worktrees: "green",
  __tests__: "green",
  ".pnpm-store": "green",
  ".tanstack": "gray",
  ".opencode": "gray",
  ".agents": "gray",
  ".code-review-graph": "gray",
  ".gstack": "gray",
  ".expect": "gray",
  ".omo": "gray",
  ".pi": "gray",
  ".impeccable": "gray",
  ".treehouse": "green",
  openspec: "gray",
};

export const MATERIAL_FOLDER_ICON_SYMBOL = "t3-folder-material";

export function materialFolderColorsForPath(pathValue: string): readonly [light: string, dark: string] {
  const base = basenameOfPath(pathValue).toLowerCase();
  const direct = MATERIAL_FOLDER_COLORS[base];
  if (direct) return direct;
  const group = MATERIAL_FOLDER_GROUP_BY_NAME[base];
  if (group) return MATERIAL_FOLDER_COLOR_BY_GROUP[group];
  return MATERIAL_FOLDER_COLOR_BY_GROUP.blue;
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

export function resolvePierreIconForEntry(
  pathValue: string,
  kind: "file" | "directory",
  _isDesktop = false,
): PierreIconResolution | null {
  if (kind === "directory") return null;
  return completeIconResolver.resolveIcon("file-tree-icon-file", pathValue);
}

export function hasSpecificPierreIconForFileName(fileName: string, _isDesktop = false): boolean {
  return resolvePierreIconForEntry(fileName, "file")?.token !== "default";
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
  container.innerHTML = `${getBuiltInSpriteSheet("complete")}${T3_FILE_ICON_SPRITE}`;
  document.body.prepend(container);
}
