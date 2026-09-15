import { describe, expect, it } from "@effect/vitest";

import {
  LAUNCH_RECIPES,
  emptyLaunchWorkspaceFacts,
  relativeToCwd,
  splitLaunchArgs,
  type LaunchRecipeResult,
  type LaunchWorkspaceFacts,
  type LaunchWorkspaceMarker,
} from "./launchRecipes.ts";

const CWD = "/work/app";

const facts = (
  overrides: {
    readonly platform?: NodeJS.Platform;
    readonly markers?: ReadonlyArray<LaunchWorkspaceMarker>;
    readonly isFlutterProject?: boolean;
    readonly isAndroidProject?: boolean;
  } = {},
): LaunchWorkspaceFacts => ({
  platform: overrides.platform ?? emptyLaunchWorkspaceFacts("linux").platform,
  markers: new Set(overrides.markers ?? []),
  isFlutterProject: overrides.isFlutterProject ?? false,
  isAndroidProject: overrides.isAndroidProject ?? false,
});

function resolve(
  config: Readonly<Record<string, unknown>> & { readonly type: string },
  workspaceFacts: LaunchWorkspaceFacts = facts(),
): LaunchRecipeResult {
  const recipe = LAUNCH_RECIPES.get(config.type);
  if (recipe === undefined) throw new Error(`No recipe for ${config.type}`);
  return recipe({ type: config.type, config, cwd: CWD, facts: workspaceFacts });
}

describe("splitLaunchArgs", () => {
  it("splits on whitespace and keeps quoted text together", () => {
    expect(splitLaunchArgs(`--name "hello world" --flag='a b'  plain ""`)).toEqual([
      "--name",
      "hello world",
      "--flag=a b",
      "plain",
      "",
    ]);
    expect(splitLaunchArgs("   ")).toEqual([]);
  });
});

describe("relativeToCwd", () => {
  it("shows paths under the working directory relative to it", () => {
    expect(relativeToCwd("/work/app/src/bin.ts", CWD)).toBe("./src/bin.ts");
    expect(relativeToCwd("/work/app", CWD)).toBe(".");
    expect(relativeToCwd("/work/application/bin.ts", CWD)).toBe("/work/application/bin.ts");
    expect(relativeToCwd("C:\\work\\app\\main.py", "C:\\work\\app")).toBe(".\\main.py");
  });
});

describe("node recipes", () => {
  it("runs the program with the configured runtime", () => {
    expect(
      resolve({
        type: "node",
        runtimeExecutable: "bun",
        program: "/work/app/src/bin.ts",
        args: ["--port", "3000"],
      }),
    ).toMatchObject({
      _tag: "exec",
      command: "bun",
      args: ["./src/bin.ts", "--port", "3000"],
      requires: "bun",
    });
  });

  it("runs package scripts through runtimeArgs without a program", () => {
    expect(
      resolve({ type: "pwa-node", runtimeExecutable: "npm", runtimeArgs: ["run-script", "dev"] }),
    ).toMatchObject({ command: "npm", args: ["run-script", "dev"], requires: "npm" });
  });

  it("defaults to node, splits string args, and skips PATH checks for runtime paths", () => {
    expect(
      resolve({ type: "node", program: "/work/app/a.js", args: "--name 'a b'" }),
    ).toMatchObject({ command: "node", args: ["./a.js", "--name", "a b"], requires: "node" });
    expect(
      resolve({
        type: "node",
        runtimeExecutable: "/work/app/node_modules/.bin/tsx",
        program: "/work/app/a.ts",
      }),
    ).toMatchObject({ requires: null });
  });

  it("uses bun for the Bun extension's configurations", () => {
    expect(resolve({ type: "bun", program: "index.ts" })).toMatchObject({
      command: "bun",
      args: ["index.ts"],
    });
  });

  it("runs node-terminal commands in a shell", () => {
    expect(resolve({ type: "node-terminal", command: "npm run dev" })).toEqual({
      _tag: "shell",
      commandLine: "npm run dev",
    });
  });

  it("explains configurations it can't run", () => {
    expect(resolve({ type: "node" })).toMatchObject({ _tag: "unsupported" });
    expect(resolve({ type: "node-terminal" })).toMatchObject({ _tag: "unsupported" });
    expect(resolve({ type: "node", program: 42 })).toEqual({
      _tag: "unsupported",
      reason: `Some fields don't match the "node" configuration format.`,
    });
  });
});

describe("dart recipe", () => {
  it("runs Flutter projects with device, target, tool and app arguments", () => {
    expect(
      resolve(
        {
          type: "dart",
          program: "/work/app/lib/main_dev.dart",
          deviceId: "emulator-5554",
          toolArgs: ["--flavor", "dev"],
          args: ["--verbose"],
        },
        facts({ isFlutterProject: true }),
      ),
    ).toMatchObject({
      command: "flutter",
      args: [
        "run",
        "--debug",
        "-d",
        "emulator-5554",
        "-t",
        "./lib/main_dev.dart",
        "--flavor",
        "dev",
        "--dart-entrypoint-args=--verbose",
      ],
      requires: "flutter",
      hotReload: true,
    });
  });

  it("only offers hot reload in debug mode", () => {
    expect(
      resolve({ type: "dart", flutterMode: "release" }, facts({ isFlutterProject: true })),
    ).toMatchObject({ args: ["run", "--release"], hotReload: false });
  });

  it("runs plain Dart programs with dart run", () => {
    expect(
      resolve({ type: "dart", program: "/work/app/bin/server.dart", args: ["8080"] }),
    ).toMatchObject({
      command: "dart",
      args: ["run", "./bin/server.dart", "8080"],
      hotReload: false,
    });
    expect(resolve({ type: "dart" })).toMatchObject({ _tag: "unsupported" });
  });
});

describe("swift recipe", () => {
  it("runs SwiftPM targets", () => {
    expect(
      resolve({ type: "swift", target: "App", configuration: "release", args: ["serve"] }),
    ).toMatchObject({ command: "swift", args: ["run", "-c", "release", "App", "serve"] });
  });

  it("runs a built program directly", () => {
    expect(resolve({ type: "swift-lldb", program: "/work/app/.build/debug/App" })).toMatchObject({
      command: "./.build/debug/App",
      args: [],
      requires: null,
    });
    expect(resolve({ type: "swift" })).toMatchObject({ _tag: "unsupported" });
  });
});

describe("native recipes", () => {
  it("turns CodeLLDB cargo builds into cargo run", () => {
    expect(
      resolve({
        type: "lldb",
        cargo: { args: ["build", "--bin=server", "--package=server", "--message-format=json"] },
        args: ["--port", "1"],
      }),
    ).toMatchObject({
      command: "cargo",
      args: ["run", "--bin=server", "--package=server", "--", "--port", "1"],
      requires: "cargo",
    });
  });

  it("runs cargo test configurations without --no-run", () => {
    expect(resolve({ type: "lldb", cargo: { args: ["test", "--no-run", "--lib"] } })).toMatchObject(
      { command: "cargo", args: ["test", "--lib"] },
    );
    expect(resolve({ type: "lldb", cargo: { args: ["bench"] } })).toMatchObject({
      _tag: "unsupported",
    });
  });

  it("runs cppdbg programs with their environment list", () => {
    expect(
      resolve({
        type: "cppdbg",
        program: "/work/app/build/app",
        args: ["-v"],
        environment: [{ name: "LOG_LEVEL", value: "debug" }],
      }),
    ).toMatchObject({
      command: "./build/app",
      args: ["-v"],
      env: { LOG_LEVEL: "debug" },
      requires: null,
    });
    expect(resolve({ type: "lldb-dap" })).toMatchObject({ _tag: "unsupported" });
  });
});

describe("go recipe", () => {
  it("maps debug, test and exec modes", () => {
    expect(
      resolve({
        type: "go",
        program: "/work/app/cmd/api",
        args: ["-port", "8080"],
        buildFlags: "-tags dev",
      }),
    ).toMatchObject({ command: "go", args: ["run", "-tags", "dev", "./cmd/api", "-port", "8080"] });
    expect(
      resolve({ type: "go", mode: "test", program: "/work/app/pkg", args: ["-test.run", "TestX"] }),
    ).toMatchObject({ args: ["test", "./pkg", "-args", "-test.run", "TestX"] });
    expect(resolve({ type: "go", mode: "exec", program: "/work/app/bin/api" })).toMatchObject({
      command: "./bin/api",
      requires: null,
    });
  });

  it("explains modes that need a debugger", () => {
    expect(resolve({ type: "go", mode: "remote", program: "/work/app" })).toEqual({
      _tag: "unsupported",
      reason: `Go "remote" mode needs a debugger.`,
    });
    expect(resolve({ type: "go" })).toMatchObject({ _tag: "unsupported" });
  });
});

describe("python recipe", () => {
  it("runs modules and programs with the configured interpreter", () => {
    expect(resolve({ type: "debugpy", module: "uvicorn", args: ["app:app"] })).toMatchObject({
      command: "python3",
      args: ["-m", "uvicorn", "app:app"],
    });
    expect(
      resolve({
        type: "python",
        program: "/work/app/main.py",
        python: "/work/app/.venv/bin/python",
        pythonArgs: ["-X", "dev"],
      }),
    ).toMatchObject({
      command: "/work/app/.venv/bin/python",
      args: ["-X", "dev", "./main.py"],
      requires: null,
    });
  });

  it("uses python on Windows", () => {
    expect(
      resolve({ type: "python", program: "main.py" }, facts({ platform: "win32" })),
    ).toMatchObject({ command: "python" });
    expect(resolve({ type: "python" })).toMatchObject({ _tag: "unsupported" });
  });
});

describe("jvm recipes", () => {
  it("runs java directly when classPaths are explicit", () => {
    expect(
      resolve({
        type: "java",
        mainClass: "com.example.App",
        classPaths: ["$Auto", "!/work/app/excluded", "/work/app/out", "/work/app/lib/dep.jar"],
        vmArgs: "-Xmx1g",
        args: ["a"],
      }),
    ).toMatchObject({
      command: "java",
      args: ["-Xmx1g", "-cp", "/work/app/out:/work/app/lib/dep.jar", "com.example.App", "a"],
    });
  });

  it("runs through the Gradle wrapper and warns that vmArgs are ignored", () => {
    const result = resolve(
      {
        type: "java",
        mainClass: "com.example.App",
        projectName: "server",
        args: ["--greeting", "hello world"],
        vmArgs: ["-Xmx1g"],
      },
      facts({ markers: ["gradlew", "build.gradle.kts"] }),
    );
    expect(result).toMatchObject({
      command: "./gradlew",
      args: [":server:run", `--args=--greeting "hello world"`],
      requires: null,
    });
    expect(result._tag === "exec" && result.warnings).toHaveLength(1);
  });

  it("uses the Windows wrappers on Windows", () => {
    expect(
      resolve(
        { type: "java", mainClass: "App" },
        facts({ platform: "win32", markers: ["gradlew.bat"] }),
      ),
    ).toMatchObject({ command: ".\\gradlew.bat" });
    expect(
      resolve(
        { type: "java", mainClass: "App" },
        facts({ platform: "win32", markers: ["mvnw.cmd"] }),
      ),
    ).toMatchObject({ command: ".\\mvnw.cmd" });
  });

  it("runs Maven projects with exec:java and passes vmArgs through MAVEN_OPTS", () => {
    expect(
      resolve(
        { type: "java", mainClass: "com.example.App", args: ["hello world"], vmArgs: "-Xmx1g" },
        facts({ markers: ["pom.xml"] }),
      ),
    ).toMatchObject({
      command: "mvn",
      args: [
        "-q",
        "compile",
        "exec:java",
        "-Dexec.mainClass=com.example.App",
        `-Dexec.args="hello world"`,
      ],
      env: { MAVEN_OPTS: "-Xmx1g" },
      requires: "mvn",
    });
  });

  it("runs Kotlin configurations through Gradle", () => {
    expect(
      resolve({ type: "kotlin", mainClass: "AppKt" }, facts({ markers: ["build.gradle.kts"] })),
    ).toMatchObject({ command: "gradle", args: ["run"], requires: "gradle" });
  });

  it("explains JVM configurations it can't run", () => {
    expect(
      resolve(
        { type: "kotlin", mainClass: "AppKt" },
        facts({ markers: ["gradlew"], isAndroidProject: true }),
      ),
    ).toEqual({ _tag: "unsupported", reason: "Android app modules aren't supported yet." });
    expect(resolve({ type: "java", mainClass: "App" })).toMatchObject({ _tag: "unsupported" });
    expect(resolve({ type: "java" })).toEqual({ _tag: "unsupported", reason: "Set `mainClass`." });
  });
});

describe("types without a run recipe", () => {
  it("explains Xcode and browser configurations", () => {
    expect(resolve({ type: "sweetpad-lldb" })).toEqual({
      _tag: "unsupported",
      reason: "Xcode app targets aren't supported yet.",
    });
    expect(resolve({ type: "pwa-chrome", url: "http://localhost:3000" })).toMatchObject({
      _tag: "unsupported",
    });
  });
});
