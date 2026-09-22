import type { CSSProperties } from "react";

/** Shadow-root overrides that make a Pierre file tree read as part of the app chrome. */
export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }

  /*
   * The entry-icon lane our @pierre/trees patch adds. The chevron keeps the
   * built-in icon lane so the lib's rotation rules still match it; this column
   * carries the file or folder glyph, and every row has one, so names line up
   * whether or not the row can expand.
   */
  [data-item-section='entry-icon'] {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: var(--trees-icon-width);
    margin-inline-end: 4px;
  }
  [data-item-section='entry-icon'] svg {
    width: 16px;
    height: 16px;
  }
`;

/** Host styles that keep a Pierre tree on the active color scheme and foreground. */
export function pierreTreeStyle(colorScheme: "light" | "dark"): CSSProperties {
  return {
    colorScheme,
    ["--trees-fg-override" as string]: "var(--contrast-foreground)",
  };
}
