import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveThreadSkillNames } from "./threadSkills";

const toolActivity = (kind: string, data: Record<string, unknown>) =>
  ({
    id: `activity-${kind}`,
    tone: "tool",
    kind,
    summary: "Tool",
    payload: { itemType: "dynamic_tool_call", data },
    turnId: null,
    createdAt: "2026-09-14T00:00:00.000Z",
  }) as unknown as OrchestrationThreadActivity;

describe("deriveThreadSkillNames", () => {
  it("lists mentioned and agent-loaded skills once each", () => {
    const names = deriveThreadSkillNames(
      [
        { context: { records: [{ kind: "skill", name: "grill-me" }, { kind: "mention" }] } },
        { context: { records: [{ kind: "skill", name: "grill-me" }] } },
        {},
      ],
      [
        toolActivity("tool.started", { toolName: "Skill", skill: "simplify" }),
        toolActivity("tool.completed", { toolName: "Skill", skill: "simplify" }),
        toolActivity("tool.completed", { toolName: "Bash" }),
        toolActivity("context-window.updated", { skill: "not-a-tool" }),
      ],
    );
    expect(names).toEqual(["grill-me", "simplify"]);
  });
});
