import { useMemo } from "react";

import { cn } from "~/lib/utils";

/**
 * A unified patch for one file, rendered as plain coloured lines. The Diff
 * surface's richer viewer wants a whole comparison; this only ever shows one
 * file inside an expanded commit row, so plain text is the honest fit.
 */

type PatchLineKind = "added" | "removed" | "hunk" | "meta" | "context";

function classifyLine(line: string): PatchLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  return "context";
}

const LINE_CLASS: Record<PatchLineKind, string> = {
  added: "bg-emerald-500/10 text-emerald-600",
  removed: "bg-rose-500/10 text-rose-600",
  hunk: "text-muted-foreground",
  meta: "text-muted-foreground/70",
  context: "",
};

export function CommitPatchView({
  patch,
  truncated,
}: {
  readonly patch: string;
  readonly truncated: boolean;
}) {
  // A patch line's identity is its position: the text repeats, and the whole
  // patch is replaced at once rather than reordered.
  const lines = useMemo(
    () =>
      patch.split("\n").map((text, position) => ({
        id: `line-${position}`,
        text,
        kind: classifyLine(text),
      })),
    [patch],
  );

  return (
    <div className="overflow-x-auto border-t bg-muted/20 font-mono text-xs leading-5">
      {lines.map((line) => (
        <div key={line.id} className={cn("whitespace-pre px-3", LINE_CLASS[line.kind])}>
          {line.text.length === 0 ? " " : line.text}
        </div>
      ))}
      {truncated && (
        <p className="px-3 py-1 text-muted-foreground">Patch truncated. Open it in the terminal.</p>
      )}
    </div>
  );
}
