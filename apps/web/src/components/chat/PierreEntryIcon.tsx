import { memo, useInsertionEffect } from "react";

import { ensurePierreIconSprite, resolvePierreIconForEntry } from "../../pierre-icons";
import { cn } from "~/lib/utils";

/**
 * The file and folder glyph for our own chrome — breadcrumbs, pickers, chips,
 * changed-file lists. Tree rows get the same sprite through `@pierre/trees`.
 *
 * Material Icon Theme bakes color into the artwork, so there is nothing to tint
 * and no light/dark variant to pick: the outer `<svg>` carries no viewBox and
 * each `<symbol>` scales its own coordinate system to whatever size CSS gives.
 */
export const PierreEntryIcon = memo(function PierreEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  mimeType?: string | undefined;
  /** Accepted for call-site parity; Material artwork is the same in both themes. */
  theme?: "light" | "dark";
  className?: string;
}) {
  useInsertionEffect(ensurePierreIconSprite, []);
  const icon = resolvePierreIconForEntry(props.pathValue, props.kind, props.mimeType);

  return (
    <svg
      aria-hidden="true"
      data-pierre-icon={icon.name}
      className={cn("size-4 shrink-0", props.className)}
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
});
