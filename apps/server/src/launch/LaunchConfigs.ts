/**
 * LaunchConfigs - reads a workspace's .vscode/launch.json and tasks.json and
 * resolves each configuration into steps T3 can run, or a reason it can't.
 *
 * The files are read on every call; clients refetch when they open the run
 * controls and after saves, so there is no watcher to keep in sync.
 *
 * @module LaunchConfigs
 */
import * as NodeOS from "node:os";

import {
  LAUNCH_JSON_RELATIVE_PATH,
  LaunchJsonFile,
  LaunchListConfigsError,
  TASKS_JSON_RELATIVE_PATH,
  TasksJsonFile,
  type LaunchListConfigsInput,
  type LaunchListConfigsResult,
  type LaunchStartersInput,
  type LaunchStartersResult,
} from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  LAUNCH_WORKSPACE_MARKERS,
  type LaunchWorkspaceFacts,
  type LaunchWorkspaceMarker,
} from "./launchRecipes.ts";
import {
  collectEnvFiles,
  collectLaunchCwds,
  collectRequiredBinaries,
  finalizeLaunchEntries,
  parseEnvFile,
  resolveLaunchFile,
} from "./launchResolution.ts";
import {
  launchStarters,
  parseCargoPackageName,
  parseSwiftExecutableTargets,
} from "./launchStarters.ts";

const decodeLaunchJson = Schema.decodeEffect(fromLenientJson(LaunchJsonFile));
const decodeTasksJson = Schema.decodeEffect(fromLenientJson(TasksJsonFile));
const decodePackageScripts = Schema.decodeEffect(
  fromLenientJson(
    Schema.Struct({ scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }),
  ),
);

const PYTHON_ENTRY_FILES = ["main.py", "app.py", "manage.py"];

const FLUTTER_SDK_DEPENDENCY = /^\s*sdk:\s*["']?flutter["']?\s*$/m;
const ANDROID_APPLICATION_PLUGIN = /com\.android\.application/;
const ANDROID_GRADLE_FILES = [
  "build.gradle",
  "build.gradle.kts",
  "app/build.gradle",
  "app/build.gradle.kts",
];

/** Service tag for launch configuration resolution. */
export class LaunchConfigs extends Context.Service<
  LaunchConfigs,
  {
    readonly list: (
      input: LaunchListConfigsInput,
    ) => Effect.Effect<LaunchListConfigsResult, LaunchListConfigsError>;
    /** Configurations the project's files suggest, for "Add configuration". */
    readonly starters: (input: LaunchStartersInput) => Effect.Effect<LaunchStartersResult>;
  }
>()("t3/launch/LaunchConfigs") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readOptionalFile = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(
      Effect.map(Option.some),
      Effect.catchTag("PlatformError", (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(Option.none<string>())
          : Effect.fail(error),
      ),
    );

  // Facts are hints for recipes, so unreadable files count as absent.
  const readHint = (filePath: string) =>
    readOptionalFile(filePath).pipe(Effect.orElseSucceed(() => Option.none<string>()));

  const gatherFacts = Effect.fn("LaunchConfigs.gatherFacts")(function* (
    cwd: string,
    platform: NodeJS.Platform,
  ) {
    const found = yield* Effect.forEach(
      LAUNCH_WORKSPACE_MARKERS,
      (marker) =>
        fileSystem.exists(path.join(cwd, marker)).pipe(
          Effect.orElseSucceed(() => false),
          Effect.map((exists) => (exists ? [marker] : [])),
        ),
      { concurrency: "unbounded" },
    );
    const markers = new Set<LaunchWorkspaceMarker>(found.flat());
    const pubspec = markers.has("pubspec.yaml")
      ? yield* readHint(path.join(cwd, "pubspec.yaml"))
      : Option.none<string>();
    const gradleFiles = yield* Effect.forEach(
      ANDROID_GRADLE_FILES,
      (file) => readHint(path.join(cwd, file)),
      { concurrency: "unbounded" },
    );
    const facts: LaunchWorkspaceFacts = {
      platform,
      markers,
      isFlutterProject: Option.isSome(pubspec) && FLUTTER_SDK_DEPENDENCY.test(pubspec.value),
      isAndroidProject: gradleFiles.some(
        (file) => Option.isSome(file) && ANDROID_APPLICATION_PLUGIN.test(file.value),
      ),
    };
    return [cwd, facts] as const;
  });

  const list = Effect.fn("LaunchConfigs.list")(function* (
    input: LaunchListConfigsInput,
  ): Effect.fn.Return<LaunchListConfigsResult, LaunchListConfigsError> {
    const env = yield* HostProcessEnvironment;
    const platform = yield* HostProcessPlatform;
    const workspaceFolder = input.cwd;

    const launchContents = yield* readOptionalFile(
      path.join(workspaceFolder, LAUNCH_JSON_RELATIVE_PATH),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new LaunchListConfigsError({
            cwd: workspaceFolder,
            message: `Failed to read ${LAUNCH_JSON_RELATIVE_PATH}.`,
            cause,
          }),
      ),
    );
    if (Option.isNone(launchContents)) {
      return { launchFile: { _tag: "missing" }, entries: [], inputs: [], warnings: [] };
    }
    const launchFile = yield* decodeLaunchJson(launchContents.value).pipe(Effect.option);
    if (Option.isNone(launchFile)) {
      return {
        launchFile: {
          _tag: "invalid",
          message: `${LAUNCH_JSON_RELATIVE_PATH} isn't valid JSON, or its configurations aren't objects.`,
        },
        entries: [],
        inputs: [],
        warnings: [],
      };
    }

    const warnings: Array<string> = [];
    const tasksContents = yield* readHint(path.join(workspaceFolder, TASKS_JSON_RELATIVE_PATH));
    let tasks: LaunchListConfigsTasks = [];
    if (Option.isSome(tasksContents)) {
      const tasksFile = yield* decodeTasksJson(tasksContents.value).pipe(Effect.option);
      if (Option.isSome(tasksFile)) tasks = tasksFile.value.tasks ?? [];
      else warnings.push(`${TASKS_JSON_RELATIVE_PATH} is invalid, so its tasks were skipped.`);
    }

    const context = {
      launchFile: launchFile.value,
      tasks,
      platform,
      variables: {
        workspaceFolder,
        userHome: env.HOME ?? env.USERPROFILE ?? NodeOS.homedir(),
        pathSeparator: path.sep,
        resolvePath: (base: string, target: string) => path.resolve(base, target),
        env,
        inputValues: input.inputValues ?? {},
      },
    };
    const factsByCwd = new Map(
      yield* Effect.forEach(collectLaunchCwds(context), (cwd) => gatherFacts(cwd, platform), {
        concurrency: 4,
      }),
    );
    const resolved = resolveLaunchFile({ ...context, factsByCwd });

    const availability = yield* Effect.forEach(
      collectRequiredBinaries(resolved.entries),
      (binary) =>
        isCommandAvailable(binary, { env }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.map((available) => [binary, available] as const),
        ),
      { concurrency: "unbounded" },
    );
    const envFiles = yield* Effect.forEach(
      collectEnvFiles(resolved.entries),
      (filePath) =>
        readHint(filePath).pipe(
          Effect.map((contents) =>
            Option.isSome(contents) ? [[filePath, parseEnvFile(contents.value)] as const] : [],
          ),
        ),
      { concurrency: "unbounded" },
    );

    return {
      launchFile: { _tag: "valid" },
      entries: finalizeLaunchEntries(resolved.entries, {
        availableBinaries: new Set(
          availability.flatMap(([binary, available]) => (available ? [binary] : [])),
        ),
        envFiles: new Map(envFiles.flat()),
      }),
      inputs: resolved.inputs,
      warnings: [...warnings, ...resolved.warnings],
    };
  });

  const starters = Effect.fn("LaunchConfigs.starters")(function* (
    input: LaunchStartersInput,
  ): Effect.fn.Return<LaunchStartersResult> {
    const platform = yield* HostProcessPlatform;
    const [, facts] = yield* gatherFacts(input.cwd, platform);
    const readRootFile = (file: string) => readHint(path.join(input.cwd, file));
    const existsAtRoot = (file: string) =>
      fileSystem.exists(path.join(input.cwd, file)).pipe(Effect.orElseSucceed(() => false));

    const packageJson = yield* readRootFile("package.json");
    const packageScripts = Option.isSome(packageJson)
      ? yield* decodePackageScripts(packageJson.value).pipe(
          Effect.map((manifest) => Object.keys(manifest.scripts ?? {})),
          Effect.orElseSucceed((): Array<string> => []),
        )
      : [];
    const packageSwift = yield* readRootFile("Package.swift");
    const cargoToml = yield* readRootFile("Cargo.toml");
    const hasGoModule = yield* existsAtRoot("go.mod");
    const pythonEntries = yield* Effect.forEach(PYTHON_ENTRY_FILES, (file) =>
      existsAtRoot(file).pipe(Effect.map((exists) => (exists ? [file] : []))),
    );

    return {
      starters: launchStarters({
        facts,
        packageScripts,
        swiftExecutableTargets: parseSwiftExecutableTargets(Option.getOrNull(packageSwift)),
        cargoPackageName: parseCargoPackageName(Option.getOrNull(cargoToml)),
        hasGoModule,
        pythonEntry: pythonEntries.flat()[0] ?? null,
      }),
    };
  });

  return LaunchConfigs.of({ list, starters });
});

type LaunchListConfigsTasks = NonNullable<TasksJsonFile["tasks"]>;

export const layer = Layer.effect(LaunchConfigs, make);
