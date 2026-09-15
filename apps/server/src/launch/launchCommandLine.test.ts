import { describe, expect, it } from "@effect/vitest";

import { launchCommandLine } from "./launchCommandLine.ts";

describe("launchCommandLine", () => {
  it("runs a program in its directory with exec", () => {
    expect(
      launchCommandLine([
        {
          _tag: "exec",
          label: "App",
          command: "bun",
          args: ["run", "dev"],
          cwd: "/work/app",
          env: {},
        },
      ]),
    ).toBe("(cd -- /work/app && exec bun run dev)");
  });

  it("quotes paths and arguments and applies env overrides and unsets", () => {
    expect(
      launchCommandLine([
        {
          _tag: "exec",
          label: "Server",
          command: "./bin/my server",
          args: ["--greeting", "hello world"],
          cwd: "/work/my app",
          env: { PORT: "4000", NODE_OPTIONS: null, MESSAGE: "it's on" },
        },
      ]),
    ).toBe(
      `(cd -- '/work/my app' && exec env -u NODE_OPTIONS PORT=4000 MESSAGE='it'\\''s on' './bin/my server' --greeting 'hello world')`,
    );
  });

  it("exports env for shell steps and chains steps so a failure stops the run", () => {
    expect(
      launchCommandLine([
        {
          _tag: "shell",
          label: "build",
          commandLine: "npm run build",
          cwd: "/work/app",
          env: { DEBUG: "1", CI: null, "not.valid": "x" },
        },
        {
          _tag: "exec",
          label: "App",
          command: "node",
          args: ["./server.js"],
          cwd: "/work/app",
          env: {},
        },
      ]),
    ).toBe(
      "(cd -- /work/app && export DEBUG=1 && unset CI && npm run build) && (cd -- /work/app && exec node ./server.js)",
    );
  });
});
