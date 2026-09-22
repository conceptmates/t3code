import {
  fileBasename,
  formatFilePathPosition,
  inlineCodeFilePathCandidate,
  normalizeMarkdownLinkDestination,
  parseMarkdownFileLink,
} from "@t3tools/client-runtime/markdown-links";
import { videoMimeType } from "@t3tools/shared/video";

import type { MARKDOWN_FILE_ICON_SOURCES } from "./markdownFileIcons.generated";
import {
  MARKDOWN_DEFAULT_FILE_ICON,
  MARKDOWN_DEFAULT_FOLDER_ICON,
  MARKDOWN_FILE_ICON_BY_EXTENSION,
  MARKDOWN_FILE_ICON_BY_NAME,
  MARKDOWN_FOLDER_ICON_BY_NAME,
} from "./markdownFileIconRules.generated";

const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;

export type MarkdownLinkPresentation =
  | {
      readonly kind: "external";
      readonly href: string;
      readonly host: string;
    }
  | {
      readonly kind: "file";
      readonly href: string;
      readonly icon: MarkdownFileIcon;
      readonly label: string;
      readonly path: string;
      readonly line?: number;
      readonly column?: number;
    }
  | {
      readonly kind: "link";
      readonly href: string | null;
    };

export type MarkdownFileIcon = keyof typeof MARKDOWN_FILE_ICON_SOURCES;

export type MarkdownLinkIcon = "github";

/**
 * Sites whose brand mark replaces the generic external-link glyph. The marks
 * are monochrome and tinted with the link color, so they follow the theme.
 */
export function resolveMarkdownLinkIcon(host: string): MarkdownLinkIcon | null {
  const hostname = host.toLowerCase();
  if (hostname === "github.com" || hostname.endsWith(".github.com")) return "github";
  return null;
}

/** Native link and media APIs have no document scheme to inherit from protocol-relative URLs. */
export function normalizeNativeMarkdownUrl(value: string): string {
  return value.startsWith("//") ? `https:${value}` : value;
}

/**
 * Mirrors the web resolver's order so a path draws the same icon on every
 * surface: exact basename, then progressively shorter extensions.
 */
export function resolveMarkdownFileIcon(value: string): MarkdownFileIcon {
  const basename = fileBasename(value).replace(POSITION_SUFFIX_PATTERN, "").toLowerCase();
  // A name the manifest misses can still be a video we know how to play.
  if (videoMimeType({ name: basename, mimeType: "" }) !== null) return "video";
  const exactIcon = MARKDOWN_FILE_ICON_BY_NAME[basename];
  if (exactIcon) return exactIcon;
  const segments = basename.split(".");
  for (let index = 1; index < segments.length; index += 1) {
    const icon = MARKDOWN_FILE_ICON_BY_EXTENSION[segments.slice(index).join(".")];
    if (icon) return icon;
  }
  return MARKDOWN_DEFAULT_FILE_ICON;
}

export function resolveMarkdownFolderIcon(value: string): MarkdownFileIcon {
  const basename = fileBasename(value).toLowerCase();
  return MARKDOWN_FOLDER_ICON_BY_NAME[basename] ?? MARKDOWN_DEFAULT_FOLDER_ICON;
}

export function resolveMarkdownLinkPresentation(href: string): MarkdownLinkPresentation {
  const normalized = normalizeMarkdownLinkDestination(href);
  try {
    const parsed = new URL(normalizeNativeMarkdownUrl(normalized));
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return {
        kind: "external",
        href: parsed.toString(),
        host: parsed.hostname,
      };
    }
  } catch {
    // Relative paths and non-URL link destinations are handled below.
  }

  const target = parseMarkdownFileLink(normalized);
  if (target) {
    return {
      kind: "file",
      href: normalized,
      icon: resolveMarkdownFileIcon(target.path),
      label: fileBasename(formatFilePathPosition(target)),
      path: target.path,
      ...(target.line ? { line: target.line } : {}),
      ...(target.column ? { column: target.column } : {}),
    };
  }

  return {
    kind: "link",
    href: /^(?:mailto|tel):/i.test(normalized) ? normalized : null,
  };
}

/** Backticks become file references only when the shared path heuristic recognizes the whole span. */
export function resolveMarkdownInlineCodePresentation(
  content: string,
): Extract<MarkdownLinkPresentation, { readonly kind: "file" }> | null {
  const candidate = inlineCodeFilePathCandidate(content);
  if (candidate === null) return null;
  const presentation = resolveMarkdownLinkPresentation(candidate);
  return presentation.kind === "file" ? presentation : null;
}
