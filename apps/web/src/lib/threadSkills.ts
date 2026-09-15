import type { OrchestrationThreadActivity } from "@t3tools/contracts";

interface MessageWithContext {
  readonly context?:
    | { readonly records: ReadonlyArray<{ readonly kind: string; readonly name?: unknown }> }
    | undefined;
}

const TOOL_ACTIVITY_KINDS = new Set(["tool.started", "tool.updated", "tool.completed"]);

/** The server projects a skill tool call's name to `data.skill`. */
function loadedSkillName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) return null;
  const data = payload.data;
  if (typeof data !== "object" || data === null || !("skill" in data)) return null;
  return typeof data.skill === "string" ? data.skill : null;
}

/**
 * Skills a thread used, each once in first-seen order: `$skill` mentions on
 * its messages, then skills the agent loaded on its own.
 */
export function deriveThreadSkillNames(
  messages: ReadonlyArray<MessageWithContext>,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): string[] {
  const names = new Set<string>();
  for (const message of messages) {
    for (const record of message.context?.records ?? []) {
      if (record.kind === "skill" && typeof record.name === "string") {
        names.add(record.name);
      }
    }
  }
  for (const activity of activities) {
    if (!TOOL_ACTIVITY_KINDS.has(activity.kind)) continue;
    const name = loadedSkillName(activity.payload);
    if (name) names.add(name);
  }
  return [...names];
}
