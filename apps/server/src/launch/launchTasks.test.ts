import { describe, expect, it } from "@effect/vitest";

import { emptyLaunchWorkspaceFacts, type LaunchWorkspaceMarker } from "./launchRecipes.ts";
import { quoteShellArg, resolvePreLaunchTask, type LaunchTaskContext } from "./launchTasks.ts";

// Paths in these tests are POSIX; the server passes the Effect Path service's resolve.
const resolvePath = (base: string, target: string) =>
  target.startsWith("/") ? target : `${base}/${target}`;

const context = (
  tasks: LaunchTaskContext["tasks"] = [],
  markers: ReadonlyArray<LaunchWorkspaceMarker> = [],
): LaunchTaskContext => ({
  tasks,
  variables: {
    workspaceFolder: "/work/app",
    userHome: "/home/dev",
    pathSeparator: "/",
    resolvePath,
    env: {},
    inputValues: {},
  },
  rootFacts: { ...emptyLaunchWorkspaceFacts("linux"), markers: new Set(markers) },
});

describe("resolvePreLaunchTask", () => {
  describe("tasks.json", () => {
    it("runs shell tasks with quoted args, cwd and env", () => {
      const tasks = [
        {
          label: "build",
          type: "shell",
          command: "npm run build",
          args: ["--mode", "dev mode"],
          options: { cwd: "${workspaceFolder}/web", env: { NODE_ENV: "development" } },
        },
      ];

      expect(resolvePreLaunchTask("build", context(tasks))).toEqual({
        _tag: "steps",
        steps: [
          {
            _tag: "shell",
            label: "build",
            commandLine: "npm run build --mode 'dev mode'",
            cwd: "/work/app/web",
            env: { NODE_ENV: "development" },
            envFile: null,
          },
        ],
        warnings: [],
        unsupportedVariables: [],
        missingInputs: [],
      });
    });

    it("runs process tasks, including quoted command objects", () => {
      const tasks = [
        { label: "compile", type: "process", command: { value: "make" }, args: [{ value: "all" }] },
      ];

      expect(resolvePreLaunchTask("compile", context(tasks))).toMatchObject({
        steps: [
          { _tag: "exec", command: "make", args: ["all"], cwd: "/work/app", requires: "make" },
        ],
      });
    });

    it("matches npm tasks by their generated label and uses the workspace package manager", () => {
      const tasks = [{ type: "npm", script: "build", path: "packages/web" }];

      expect(
        resolvePreLaunchTask("npm: build - packages/web", context(tasks, ["pnpm-lock.yaml"])),
      ).toMatchObject({
        steps: [{ command: "pnpm", args: ["run", "build"], cwd: "/work/app/packages/web" }],
      });
    });

    it("runs cargo, swift and flutter typed tasks", () => {
      const tasks = [
        { label: "rust: cargo build", type: "cargo", command: "build", args: ["--bin", "api"] },
        { label: "swift: Build All", type: "swift", args: ["build", "--build-tests"] },
        { label: "pub get", type: "flutter", command: "flutter", args: ["pub", "get"] },
      ];

      expect(resolvePreLaunchTask("rust: cargo build", context(tasks))).toMatchObject({
        steps: [{ command: "cargo", args: ["build", "--bin", "api"] }],
      });
      expect(resolvePreLaunchTask("swift: Build All", context(tasks))).toMatchObject({
        steps: [{ command: "swift", args: ["build", "--build-tests"] }],
      });
      expect(resolvePreLaunchTask("pub get", context(tasks))).toMatchObject({
        steps: [{ command: "flutter", args: ["pub", "get"] }],
      });
    });

    it("wins over a provider label with the same name", () => {
      const tasks = [{ label: "npm: dev", type: "shell", command: "echo custom" }];

      expect(resolvePreLaunchTask("npm: dev", context(tasks))).toMatchObject({
        steps: [{ _tag: "shell", commandLine: "echo custom" }],
      });
    });

    it("skips background tasks and warns about dependsOn", () => {
      const tasks = [
        { label: "watch", type: "shell", command: "tsc -w", isBackground: true },
        { label: "prep", type: "shell", command: "make prep", dependsOn: ["watch"] },
      ];

      expect(resolvePreLaunchTask("watch", context(tasks))).toEqual({
        _tag: "skipped",
        warning: `preLaunchTask "watch" runs in the background, so it was skipped.`,
      });
      expect(resolvePreLaunchTask("prep", context(tasks))).toMatchObject({
        warnings: [`dependsOn in task "prep" isn't supported, so only that task runs.`],
      });
    });

    it("reports variables and inputs the task can't resolve yet", () => {
      const tasks = [{ label: "open", type: "shell", command: "echo ${file} ${input:target}" }];

      expect(resolvePreLaunchTask("open", context(tasks))).toMatchObject({
        unsupportedVariables: ["file"],
        missingInputs: ["target"],
      });
    });

    it("skips task types T3 can't run", () => {
      const tasks = [{ label: "gradle build", type: "gradle", script: "build" }];

      expect(resolvePreLaunchTask("gradle build", context(tasks))).toEqual({
        _tag: "skipped",
        warning: `T3 can't run preLaunchTask "gradle build", so it was skipped.`,
      });
    });
  });

  describe("extension-provided labels", () => {
    it("runs npm scripts with the detected package manager", () => {
      expect(resolvePreLaunchTask("npm: dev", context([], ["bun.lock"]))).toMatchObject({
        steps: [{ command: "bun", args: ["run", "dev"], cwd: "/work/app", requires: "bun" }],
      });
      expect(resolvePreLaunchTask("npm: build - apps/web", context())).toMatchObject({
        steps: [{ command: "npm", args: ["run", "build"], cwd: "/work/app/apps/web" }],
      });
    });

    it("runs Swift extension builds", () => {
      expect(resolvePreLaunchTask("swift: Build Debug App", context())).toMatchObject({
        steps: [{ command: "swift", args: ["build", "--product", "App"] }],
      });
      expect(resolvePreLaunchTask("swift: Build Release App", context())).toMatchObject({
        steps: [{ command: "swift", args: ["build", "-c", "release", "--product", "App"] }],
      });
      expect(resolvePreLaunchTask("swift: Build All (MyPackage)", context())).toMatchObject({
        steps: [{ command: "swift", args: ["build"] }],
      });
    });

    it("runs cargo labels", () => {
      expect(resolvePreLaunchTask("rust: cargo build --release", context())).toMatchObject({
        steps: [{ command: "cargo", args: ["build", "--release"] }],
      });
      expect(resolvePreLaunchTask("cargo test", context())).toMatchObject({
        steps: [{ command: "cargo", args: ["test"] }],
      });
    });

    it("runs tsc builds and skips tsc watch", () => {
      expect(resolvePreLaunchTask("tsc: build - tsconfig.json", context())).toMatchObject({
        steps: [{ command: "npx", args: ["tsc", "-p", "tsconfig.json"] }],
      });
      expect(
        resolvePreLaunchTask("tsc: build - tsconfig.json", context([], ["pnpm-lock.yaml"])),
      ).toMatchObject({
        steps: [{ command: "pnpm", args: ["exec", "tsc", "-p", "tsconfig.json"] }],
      });
      expect(resolvePreLaunchTask("tsc: watch - tsconfig.json", context())).toMatchObject({
        _tag: "skipped",
      });
    });

    it("skips labels nothing defines", () => {
      expect(resolvePreLaunchTask("deploy", context())).toEqual({
        _tag: "skipped",
        warning: `preLaunchTask "deploy" isn't defined in tasks.json, so it was skipped.`,
      });
    });
  });
});

describe("quoteShellArg", () => {
  it("quotes only arguments the shell would split or expand", () => {
    expect(quoteShellArg("--port=3000")).toBe("--port=3000");
    expect(quoteShellArg("it's here")).toBe(`'it'\\''s here'`);
    expect(quoteShellArg("$HOME")).toBe(`'$HOME'`);
  });
});
