import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as LaunchConfigs from "./LaunchConfigs.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(LaunchConfigs.layer),
  Layer.provideMerge(NodeServices.layer),
);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const makeWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-launch-" });
});

const writeWorkspaceFile = Effect.fn("writeWorkspaceFile")(function* (
  root: string,
  relativePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(root, relativePath);
  yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(Effect.orDie);
  yield* fileSystem.writeFileString(filePath, contents).pipe(Effect.orDie);
  return filePath;
});

/** Lists configurations with a PATH holding only fake `binaries`, so toolchain checks are deterministic. */
const listWithToolchain = Effect.fn("listWithToolchain")(function* (
  root: string,
  binaries: ReadonlyArray<string>,
  inputValues?: Record<string, string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const binary of binaries) {
    const filePath = yield* writeWorkspaceFile(root, path.join(".bin", binary), "#!/bin/sh\n");
    yield* fileSystem.chmod(filePath, 0o755).pipe(Effect.orDie);
  }
  const launchConfigs = yield* LaunchConfigs.LaunchConfigs;
  return yield* launchConfigs
    .list(inputValues === undefined ? { cwd: root } : { cwd: root, inputValues })
    .pipe(
      Effect.provideService(HostProcessEnvironment, { PATH: path.join(root, ".bin"), HOME: root }),
    );
});

it.layer(TestLayer)("LaunchConfigs", (it) => {
  describe("starters", () => {
    it.effect("suggests configurations from the project's files", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace;
        yield* writeWorkspaceFile(
          root,
          "package.json",
          encodeJson({ scripts: { dev: "vite", test: "vitest" } }),
        );
        yield* writeWorkspaceFile(root, "bun.lock", "");
        yield* writeWorkspaceFile(root, "go.mod", "module example.com/app\n");
        yield* writeWorkspaceFile(root, "app.py", "");

        const launchConfigs = yield* LaunchConfigs.LaunchConfigs;
        const result = yield* launchConfigs.starters({ cwd: root });

        expect(result.starters.map((starter) => starter.label)).toEqual([
          "bun run dev",
          "Go",
          "Python: app.py",
        ]);
      }),
    );
  });

  describe("list", () => {
    it.effect("reports a missing launch.json", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace;

        expect(yield* listWithToolchain(root, [])).toEqual({
          launchFile: { _tag: "missing" },
          entries: [],
          inputs: [],
          warnings: [],
        });
      }),
    );

    it.effect("reports an invalid launch.json without failing", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace;
        yield* writeWorkspaceFile(root, ".vscode/launch.json", "{ nope");

        const result = yield* listWithToolchain(root, []);

        expect(result.launchFile._tag).toBe("invalid");
        expect(result.entries).toEqual([]);
      }),
    );

    it.effect("resolves JSONC configurations against the machine's toolchain", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace;
        yield* writeWorkspaceFile(root, "bun.lock", "");
        yield* writeWorkspaceFile(root, ".env", "PORT=4000\n");
        yield* writeWorkspaceFile(
          root,
          ".vscode/launch.json",
          `{
            // Comments and trailing commas are fine, as in VS Code.
            "version": "0.2.0",
            "configurations": [
              {
                "type": "node",
                "request": "launch",
                "name": "Server",
                "runtimeExecutable": "bun",
                "program": "\${workspaceFolder}/src/bin.ts",
                "envFile": "\${workspaceFolder}/.env",
                "env": { "DEBUG": "1" },
                "preLaunchTask": "npm: build",
              },
              { "type": "go", "request": "launch", "name": "API", "program": "\${workspaceFolder}/cmd/api" },
            ],
          }`,
        );

        const result = yield* listWithToolchain(root, ["bun"]);

        expect(result.launchFile).toEqual({ _tag: "valid" });
        expect(result.entries.map((entry) => entry.status)).toEqual([
          {
            _tag: "runnable",
            steps: [
              {
                _tag: "exec",
                label: "npm: build",
                command: "bun",
                args: ["run", "build"],
                cwd: root,
                env: {},
              },
              {
                _tag: "exec",
                label: "Server",
                command: "bun",
                args: ["./src/bin.ts"],
                cwd: root,
                env: { PORT: "4000", DEBUG: "1" },
              },
            ],
          },
          { _tag: "missing-toolchain", binary: "go" },
        ]);
      }),
    );

    it.effect("detects Flutter projects in a configuration's working directory", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace;
        yield* writeWorkspaceFile(
          root,
          "mobile/pubspec.yaml",
          "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n",
        );
        yield* writeWorkspaceFile(
          root,
          ".vscode/launch.json",
          encodeJson({
            configurations: [
              {
                type: "dart",
                request: "launch",
                name: "Mobile",
                cwd: "${workspaceFolder}/mobile",
                program: "lib/main.dart",
                deviceId: "emulator-5554",
              },
            ],
          }),
        );

        const result = yield* listWithToolchain(root, ["flutter"]);

        expect(result.entries[0]).toMatchObject({
          hotReload: true,
          status: {
            _tag: "runnable",
            steps: [
              {
                command: "flutter",
                args: ["run", "--debug", "-d", "emulator-5554", "-t", "lib/main.dart"],
              },
            ],
          },
        });
      }),
    );

    it.effect("recognizes Android Gradle builds", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace;
        yield* writeWorkspaceFile(root, "gradlew", "#!/bin/sh\n");
        yield* writeWorkspaceFile(
          root,
          "app/build.gradle.kts",
          'plugins {\n  id("com.android.application")\n}\n',
        );
        yield* writeWorkspaceFile(
          root,
          ".vscode/launch.json",
          encodeJson({
            configurations: [
              { type: "kotlin", request: "launch", name: "App", mainClass: "AppKt" },
            ],
          }),
        );

        const result = yield* listWithToolchain(root, []);

        expect(result.entries[0]?.status).toEqual({
          _tag: "unsupported",
          reason: "Android app modules aren't supported yet.",
        });
      }),
    );

    it.effect("skips an invalid tasks.json with a warning", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace;
        yield* writeWorkspaceFile(root, ".vscode/tasks.json", "{ broken");
        yield* writeWorkspaceFile(
          root,
          ".vscode/launch.json",
          encodeJson({
            configurations: [
              { type: "node", name: "App", program: "app.js", preLaunchTask: "build" },
            ],
          }),
        );

        const result = yield* listWithToolchain(root, ["node"]);

        expect(result.warnings).toEqual([
          ".vscode/tasks.json is invalid, so its tasks were skipped.",
        ]);
        expect(result.entries[0]).toMatchObject({
          warnings: [`preLaunchTask "build" isn't defined in tasks.json, so it was skipped.`],
          status: { _tag: "runnable" },
        });
      }),
    );

    it.effect("resolves input values passed by the client", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace;
        yield* writeWorkspaceFile(
          root,
          ".vscode/launch.json",
          encodeJson({
            configurations: [
              { type: "node", name: "App", program: "app.js", args: ["${input:name}"] },
            ],
            inputs: [{ id: "name", type: "promptString" }],
          }),
        );

        const pending = yield* listWithToolchain(root, ["node"]);
        const provided = yield* listWithToolchain(root, ["node"], { name: "Ada" });

        expect(pending.entries[0]?.status).toEqual({ _tag: "needs-inputs", inputIds: ["name"] });
        expect(provided.entries[0]?.status).toMatchObject({ steps: [{ args: ["app.js", "Ada"] }] });
      }),
    );
  });
});
