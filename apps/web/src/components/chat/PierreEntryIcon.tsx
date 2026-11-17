import { memo } from "react";

import { ensurePierreIconSprite, resolvePierreIconForEntry } from "../../pierre-icons";
import { cn } from "~/lib/utils";

// Every icon references the one shared sprite, so it is in the document before any renders.
ensurePierreIconSprite();

/**
 * Material artwork bakes in its color, so there is nothing to tint per theme.
 * Each `<symbol>` scales its own viewBox into the outer square, which keeps the
 * icon square even before CSS sizes it.
 */
export const PierreEntryIcon = memo(function PierreEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  mimeType?: string | undefined;
  /** Accepted for call-site parity; Material artwork is the same in both themes. */
  theme?: "light" | "dark";
  className?: string;
}) {
  const icon = resolvePierreIconForEntry(props.pathValue, props.kind, props.mimeType);

  return (
    <svg
      aria-hidden="true"
      data-pierre-icon={icon.name}
      className={cn("size-4 shrink-0", props.className)}
      viewBox="0 0 16 16"
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
});
