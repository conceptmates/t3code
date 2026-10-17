import type { CSSProperties } from "react";

export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 0.75rem;
  }
  button[data-type='item'], button[data-type='item']::before { border-radius: var(--radius-md); }
  svg[data-icon-name='t3-tree-icon-loading'] { opacity: 0.6; }
  @media (prefers-reduced-motion: no-preference) {
    svg[data-icon-name='t3-tree-icon-loading'] { animation: t3-tree-spin 1s linear infinite; }
  }
  @keyframes t3-tree-spin { to { transform: rotate(360deg); } }

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

export function pierreTreeStyle(colorScheme: "light" | "dark"): CSSProperties {
  return {
    colorScheme,
    ["--trees-fg-override" as string]: "var(--contrast-foreground)",
  };
}
