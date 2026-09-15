import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { formatEnvironmentQueryError } from "./query.ts";

describe("formatEnvironmentQueryError", () => {
  it("prefers the error's own message", () => {
    const cause = Cause.fail(new Error("Failed to read .vscode/launch.json."));
    expect(formatEnvironmentQueryError(cause)).toBe("Failed to read .vscode/launch.json.");
  });

  // A remote environment too old to know an RPC fails outside the declared error
  // channel, so the reader used to get a bare "The environment request failed."
  it("names a cause that carries no message", () => {
    const cause = Cause.die({ _tag: "RpcNotFound", method: "launch.listConfigs" });
    const message = formatEnvironmentQueryError(cause);
    expect(message).not.toBe("The environment request failed.");
    expect(message).toContain("launch.listConfigs");
  });

  it("falls back when the cause describes nothing", () => {
    const cause = Cause.die("");
    expect(formatEnvironmentQueryError(cause)).toBe("The environment request failed.");
  });
});
