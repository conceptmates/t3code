import { describe, expect, it } from "@effect/vitest";

import {
  emptyLaunchWorkspaceFacts,
  type LaunchWorkspaceFacts,
  type LaunchWorkspaceMarker,
} from "./launchRecipes.ts";
import {
  launchStarters,
  parseCargoPackageName,
  parseSwiftExecutableTargets,
  type LaunchStarterInput,
} from "./launchStarters.ts";

const facts = (
  markers: ReadonlyArray<LaunchWorkspaceMarker> = [],
  isFlutterProject = false,
): LaunchWorkspaceFacts => ({
  ...emptyLaunchWorkspaceFacts("linux"),
  markers: new Set(markers),
  isFlutterProject,
});

const input = (overrides: Partial<LaunchStarterInput> = {}): LaunchStarterInput => ({
  facts: facts(),
  packageScripts: [],
  swiftExecutableTargets: [],
  cargoPackageName: null,
  hasGoModule: false,
  pythonEntry: null,
  ...overrides,
});

const configurations = (starterInput: LaunchStarterInput) =>
  launchStarters(starterInput).map((starter) => starter.configuration);

describe("launchStarters", () => {
  it("offers dev-server package scripts with the workspace package manager", () => {
    expect(
      configurations(
        input({ facts: facts(["pnpm-lock.yaml"]), packageScripts: ["build", "start", "dev"] }),
      ),
    ).toEqual([
      {
        request: "launch",
        type: "node",
        name: "pnpm run dev",
        runtimeExecutable: "pnpm",
        runtimeArgs: ["run", "dev"],
        cwd: "${workspaceFolder}",
      },
      {
        request: "launch",
        type: "node",
        name: "pnpm run start",
        runtimeExecutable: "pnpm",
        runtimeArgs: ["run", "start"],
        cwd: "${workspaceFolder}",
      },
    ]);
  });

  it("tells Flutter apps from plain Dart packages", () => {
    expect(configurations(input({ facts: facts(["pubspec.yaml"], true) }))).toEqual([
      { request: "launch", type: "dart", name: "Flutter", program: "lib/main.dart" },
    ]);
    expect(configurations(input({ facts: facts(["pubspec.yaml"]) }))).toEqual([
      { request: "launch", type: "dart", name: "Dart", program: "bin/main.dart" },
    ]);
  });

  it("offers Swift targets, Rust binaries, Go modules and Python entry points", () => {
    expect(
      configurations(
        input({
          swiftExecutableTargets: ["Server"],
          cargoPackageName: "api",
          hasGoModule: true,
          pythonEntry: "manage.py",
        }),
      ),
    ).toEqual([
      { request: "launch", type: "swift", name: "Run Server", target: "Server" },
      {
        request: "launch",
        type: "lldb",
        name: "Run api",
        cargo: { args: ["build", "--bin=api"] },
        args: [],
      },
      {
        request: "launch",
        type: "go",
        name: "Go: run",
        mode: "auto",
        program: "${workspaceFolder}",
      },
      {
        request: "launch",
        type: "debugpy",
        name: "Python: manage.py",
        program: "${workspaceFolder}/manage.py",
        args: ["runserver"],
      },
    ]);
  });

  it("prefers Gradle over Maven for JVM projects", () => {
    expect(
      launchStarters(input({ facts: facts(["build.gradle.kts", "pom.xml"]) })).map(
        (starter) => starter.label,
      ),
    ).toEqual(["Gradle: run"]);
    expect(
      launchStarters(input({ facts: facts(["pom.xml"]) })).map((starter) => starter.label),
    ).toEqual(["Maven: exec:java"]);
  });

  it("offers nothing for an empty project", () => {
    expect(launchStarters(input())).toEqual([]);
  });
});

describe("parseSwiftExecutableTargets", () => {
  it("reads executable target names once each", () => {
    expect(
      parseSwiftExecutableTargets(`
        targets: [
          .executableTarget(name: "Server", dependencies: []),
          .target(name: "Core"),
          .executableTarget(
            name: "Tool"
          ),
          .executableTarget(name: "Server"),
        ]
      `),
    ).toEqual(["Server", "Tool"]);
    expect(parseSwiftExecutableTargets(null)).toEqual([]);
  });
});

describe("parseCargoPackageName", () => {
  it("reads the package name and ignores names in other sections", () => {
    expect(
      parseCargoPackageName(`
        [workspace]
        members = ["crates/*"]

        [package]
        name = "api"
        version = "0.1.0"

        [[bin]]
        name = "other"
      `),
    ).toBe("api");
    expect(parseCargoPackageName('[workspace]\nmembers = ["a"]\n')).toBeNull();
    expect(parseCargoPackageName(null)).toBeNull();
  });
});
