import { describe, expect, it } from "@effect/vitest";
import type { LaunchJsonFile } from "@t3tools/contracts";

import { emptyLaunchWorkspaceFacts, type LaunchWorkspaceFacts } from "./launchRecipes.ts";
import {
  collectEnvFiles,
  collectLaunchCwds,
  collectRequiredBinaries,
  finalizeLaunchEntries,
  parseEnvFile,
  resolveLaunchFile,
  type LaunchResolutionContext,
} from "./launchResolution.ts";

const WORKSPACE = "/work/app";

// Paths in these tests are POSIX; the server passes the Effect Path service's resolve.
const resolvePath = (base: string, target: string) =>
  target.startsWith("/") ? target : `${base}/${target}`;

const makeContext = (
  launchFile: LaunchJsonFile,
  overrides: Partial<LaunchResolutionContext> = {},
): LaunchResolutionContext => ({
  launchFile,
  tasks: [],
  platform: "linux",
  variables: {
    workspaceFolder: WORKSPACE,
    userHome: "/home/dev",
    pathSeparator: "/",
    resolvePath,
    env: {},
    inputValues: {},
  },
  ...overrides,
});

function resolveEntries(
  context: LaunchResolutionContext,
  options: {
    readonly available?: ReadonlyArray<string>;
    readonly envFiles?: Readonly<Record<string, Record<string, string>>>;
    readonly factsByCwd?: ReadonlyMap<string, LaunchWorkspaceFacts>;
  } = {},
) {
  const resolved = resolveLaunchFile({ ...context, factsByCwd: options.factsByCwd ?? new Map() });
  const entries = finalizeLaunchEntries(resolved.entries, {
    availableBinaries: new Set(options.available ?? []),
    envFiles: new Map(Object.entries(options.envFiles ?? {})),
  });
  return { resolved, entries };
}

const serverConfig = {
  type: "node",
  request: "launch",
  name: "Server",
  program: "${workspaceFolder}/server.js",
  preLaunchTask: "npm: build",
  env: { SHARED: "config" },
  envFile: "${workspaceFolder}/.env",
};

describe("resolveLaunchFile", () => {
  it("runs the preLaunchTask before the launch, with envFile values beneath env", () => {
    const context = makeContext({ configurations: [serverConfig] });
    const { resolved, entries } = resolveEntries(context, {
      available: ["node", "npm"],
      envFiles: { "/work/app/.env": { SHARED: "file", PORT: "4000" } },
    });

    expect(collectRequiredBinaries(resolved.entries)).toEqual(["npm", "node"]);
    expect(collectEnvFiles(resolved.entries)).toEqual(["/work/app/.env"]);
    expect(entries).toEqual([
      {
        name: "Server",
        kind: "configuration",
        type: "node",
        request: "launch",
        configurations: [],
        hotReload: false,
        warnings: [],
        status: {
          _tag: "runnable",
          steps: [
            {
              _tag: "exec",
              label: "npm: build",
              command: "npm",
              args: ["run", "build"],
              cwd: WORKSPACE,
              env: {},
            },
            {
              _tag: "exec",
              label: "Server",
              command: "node",
              args: ["./server.js"],
              cwd: WORKSPACE,
              env: { SHARED: "config", PORT: "4000" },
            },
          ],
        },
      },
    ]);
  });

  it("reports the first missing toolchain and unreadable envFiles", () => {
    const { entries } = resolveEntries(makeContext({ configurations: [serverConfig] }), {
      available: ["node"],
    });

    expect(entries[0]?.status).toEqual({ _tag: "missing-toolchain", binary: "npm" });
    expect(entries[0]?.warnings).toEqual(["envFile /work/app/.env couldn't be read."]);
  });

  it("applies the platform override block for the server's platform", () => {
    const launchFile = {
      configurations: [
        {
          type: "python",
          name: "Script",
          program: "main.py",
          osx: { python: "python3.12" },
          windows: { python: "py" },
        },
      ],
    };

    const onMac = resolveEntries(makeContext(launchFile, { platform: "darwin" }), {
      available: ["python3.12"],
    });
    const onLinux = resolveEntries(makeContext(launchFile), { available: ["python3"] });

    expect(onMac.entries[0]?.status).toMatchObject({ steps: [{ command: "python3.12" }] });
    expect(onLinux.entries[0]?.status).toMatchObject({ steps: [{ command: "python3" }] });
  });

  it("uses facts from each configuration's own working directory", () => {
    const context = makeContext({
      configurations: [
        {
          type: "dart",
          name: "Mobile",
          cwd: "${workspaceFolder}/mobile",
          program: "lib/main.dart",
        },
      ],
    });
    const factsByCwd = new Map([
      ["/work/app/mobile", { ...emptyLaunchWorkspaceFacts("linux"), isFlutterProject: true }],
    ]);

    expect(collectLaunchCwds(context)).toEqual([WORKSPACE, "/work/app/mobile"]);
    const { entries } = resolveEntries(context, { available: ["flutter"], factsByCwd });
    expect(entries[0]).toMatchObject({
      hotReload: true,
      status: {
        _tag: "runnable",
        steps: [
          {
            command: "flutter",
            args: ["run", "--debug", "-t", "lib/main.dart"],
            cwd: "/work/app/mobile",
          },
        ],
      },
    });
  });

  it("explains configurations it can't run", () => {
    const { entries } = resolveEntries(
      makeContext({
        configurations: [
          { type: "node", request: "attach", name: "Attach", port: 9229 },
          { type: "ruby", request: "launch", name: "Rails" },
          { type: "node", request: "launch", name: "Current file", program: "${file}" },
          { request: "launch", program: "main.js" },
        ],
      }),
    );

    expect(entries.map((entry) => [entry.name, entry.status])).toEqual([
      [
        "Attach",
        {
          _tag: "unsupported",
          reason: "Attach configurations need a debugger, which T3 doesn't have yet.",
        },
      ],
      ["Rails", { _tag: "unsupported", reason: `T3 can't run "ruby" configurations yet.` }],
      [
        "Current file",
        {
          _tag: "unsupported",
          reason: "Uses ${file}, which T3 can't resolve outside an editor.",
        },
      ],
      [
        "Configuration 4",
        { _tag: "unsupported", reason: "Configurations need a string `name` and `type`." },
      ],
    ]);
  });

  it("keeps a runnable launch when its preLaunchTask can't be found", () => {
    const { entries } = resolveEntries(
      makeContext({
        configurations: [{ type: "node", name: "App", program: "app.js", preLaunchTask: "deploy" }],
      }),
      { available: ["node"] },
    );

    expect(entries[0]).toMatchObject({
      warnings: [`preLaunchTask "deploy" isn't defined in tasks.json, so it was skipped.`],
      status: { _tag: "runnable", steps: [{ label: "App" }] },
    });
  });

  it("asks for inputs, then resolves them once values are provided", () => {
    const launchFile = {
      configurations: [
        { type: "node", name: "App", program: "app.js", args: ["--port", "${input:port}"] },
      ],
      inputs: [
        { id: "port", type: "promptString", description: "Port", default: "3000" },
        {
          id: "mode",
          type: "pickString",
          options: ["dev", { label: "Production", value: "prod" }],
        },
        { id: "picked", type: "command", command: "extension.pickProcess" },
      ],
    };

    const pending = resolveEntries(makeContext(launchFile), { available: ["node"] });
    expect(pending.entries[0]?.status).toEqual({ _tag: "needs-inputs", inputIds: ["port"] });
    expect(pending.resolved.inputs).toEqual([
      {
        id: "port",
        type: "promptString",
        description: "Port",
        default: "3000",
        options: [],
        password: false,
      },
      {
        id: "mode",
        type: "pickString",
        description: null,
        default: null,
        options: [
          { label: "dev", value: "dev" },
          { label: "Production", value: "prod" },
        ],
        password: false,
      },
    ]);
    expect(pending.resolved.warnings).toEqual([
      `Input "picked" has type "command", which T3 doesn't support.`,
    ]);

    const provided = resolveEntries(
      makeContext(launchFile, {
        variables: { ...makeContext(launchFile).variables, inputValues: { port: "4000" } },
      }),
      { available: ["node"] },
    );
    expect(provided.entries[0]?.status).toMatchObject({
      steps: [{ args: ["app.js", "--port", "4000"] }],
    });
  });
});

describe("compounds", () => {
  const launchFile = {
    configurations: [
      { type: "node", name: "Web", program: "web.js" },
      { type: "go", name: "API", program: "${workspaceFolder}/cmd/api" },
      { type: "node", name: "Worker", program: "worker.js", args: ["${input:queue}"] },
      { type: "node", request: "attach", name: "Attach" },
    ],
    compounds: [
      { name: "Web only", configurations: ["Web"] },
      { name: "Full stack", configurations: ["Web", { name: "API" }] },
      { name: "Background", configurations: ["Web", "Worker"] },
      { name: "Broken member", configurations: ["Web", "Attach"] },
      { name: "Typo", configurations: ["Web", "Wbe"] },
      { name: "Empty", configurations: [] },
      { name: "Malformed" },
    ],
  };

  it("derives each compound's status from its members", () => {
    const { entries } = resolveEntries(makeContext(launchFile), { available: ["node"] });
    const compounds = entries.filter((entry) => entry.kind === "compound");

    expect(compounds.map((entry) => [entry.name, entry.configurations, entry.status])).toEqual([
      ["Web only", ["Web"], { _tag: "runnable", steps: [] }],
      ["Full stack", ["Web", "API"], { _tag: "missing-toolchain", binary: "go" }],
      ["Background", ["Web", "Worker"], { _tag: "needs-inputs", inputIds: ["queue"] }],
      [
        "Broken member",
        ["Web", "Attach"],
        {
          _tag: "unsupported",
          reason: `"Attach": Attach configurations need a debugger, which T3 doesn't have yet.`,
        },
      ],
      [
        "Typo",
        ["Web", "Wbe"],
        { _tag: "unsupported", reason: `Configuration "Wbe" doesn't exist.` },
      ],
      ["Empty", [], { _tag: "unsupported", reason: "This compound has no configurations." }],
      [
        "Malformed",
        [],
        { _tag: "unsupported", reason: "Compounds need a `name` and a `configurations` list." },
      ],
    ]);
  });

  it("runs a compound preLaunchTask once, before its members", () => {
    const { entries } = resolveEntries(
      makeContext({
        configurations: [{ type: "node", name: "Web", program: "web.js" }],
        compounds: [{ name: "All", configurations: ["Web"], preLaunchTask: "npm: build" }],
      }),
      { available: ["node", "npm"] },
    );

    expect(entries[1]?.status).toMatchObject({
      _tag: "runnable",
      steps: [{ label: "npm: build", command: "npm" }],
    });
  });
});

describe("parseEnvFile", () => {
  it("reads KEY=VALUE lines with comments, export prefixes and quotes", () => {
    expect(
      parseEnvFile(
        [
          "# comment",
          "export A=1",
          'B = "two\\nlines"',
          "C='single $quoted'",
          "",
          "not a variable",
          "D=",
        ].join("\r\n"),
      ),
    ).toEqual({ A: "1", B: "two\nlines", C: "single $quoted", D: "" });
  });
});
