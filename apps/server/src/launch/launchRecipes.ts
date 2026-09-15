/**
 * Run recipes turn a launch configuration of one debug `type` into a process
 * T3 can start without a debugger.
 *
 * Recipes see the configuration after variable substitution plus facts the
 * server gathered about its working directory. They never touch the
 * filesystem, so each mapping is testable as plain data. Adding support for a
 * new VS Code extension means adding a recipe here.
 *
 * @module launchRecipes
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Files checked in each configuration's working directory. */
export const LAUNCH_WORKSPACE_MARKERS = [
  "gradlew",
  "gradlew.bat",
  "build.gradle",
  "build.gradle.kts",
  "mvnw",
  "mvnw.cmd",
  "pom.xml",
  "pubspec.yaml",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;
export type LaunchWorkspaceMarker = (typeof LAUNCH_WORKSPACE_MARKERS)[number];

export interface LaunchWorkspaceFacts {
  readonly platform: NodeJS.Platform;
  readonly markers: ReadonlySet<LaunchWorkspaceMarker>;
  /** pubspec.yaml depends on the Flutter SDK. */
  readonly isFlutterProject: boolean;
  /** A Gradle build applies the Android application plugin. */
  readonly isAndroidProject: boolean;
}

export const emptyLaunchWorkspaceFacts = (platform: NodeJS.Platform): LaunchWorkspaceFacts => ({
  platform,
  markers: new Set(),
  isFlutterProject: false,
  isAndroidProject: false,
});

export interface LaunchRecipeInput {
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
  /** Absolute working directory the process starts in. */
  readonly cwd: string;
  readonly facts: LaunchWorkspaceFacts;
}

export type LaunchRecipeResult =
  | {
      readonly _tag: "exec";
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      /** Binary that must be on PATH, or null when `command` is a path. */
      readonly requires: string | null;
      readonly env: Readonly<Record<string, string>>;
      readonly hotReload: boolean;
      readonly warnings: ReadonlyArray<string>;
    }
  | { readonly _tag: "shell"; readonly commandLine: string }
  | { readonly _tag: "unsupported"; readonly reason: string };

export type LaunchRecipe = (input: LaunchRecipeInput) => LaunchRecipeResult;

interface ExecOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly hotReload?: boolean;
  readonly warnings?: ReadonlyArray<string>;
}

export const isPathLikeCommand = (command: string) => /[\\/]/.test(command);

const exec = (
  command: string,
  args: ReadonlyArray<string>,
  options: ExecOptions = {},
): LaunchRecipeResult => ({
  _tag: "exec",
  command,
  args,
  requires: isPathLikeCommand(command) ? null : command,
  env: options.env ?? {},
  hotReload: options.hotReload ?? false,
  warnings: options.warnings ?? [],
});

const unsupported = (reason: string): LaunchRecipeResult => ({ _tag: "unsupported", reason });

const invalidFields = (type: string) =>
  unsupported(`Some fields don't match the "${type}" configuration format.`);

/** Splits a string-form `args` value into argv, honoring single and double quotes. */
export function splitLaunchArgs(value: string): Array<string> {
  const args: Array<string> = [];
  let current = "";
  let inToken = false;
  let quote: string | null = null;
  for (const char of value) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
    } else if (/\s/.test(char)) {
      if (inToken) args.push(current);
      current = "";
      inToken = false;
    } else {
      current += char;
      inToken = true;
    }
  }
  if (inToken) args.push(current);
  return args;
}

const toArgs = (value: string | ReadonlyArray<string> | undefined): Array<string> =>
  value === undefined ? [] : typeof value === "string" ? splitLaunchArgs(value) : [...value];

/** Shows paths under `cwd` as `./relative`, which also keeps Go reading them as directories. */
export function relativeToCwd(target: string, cwd: string): string {
  if (target === cwd) return ".";
  for (const separator of ["/", "\\"]) {
    const prefix = cwd.endsWith(separator) ? cwd : `${cwd}${separator}`;
    if (target.startsWith(prefix)) return `.${separator}${target.slice(prefix.length)}`;
  }
  return target;
}

// For flags that take a whole argument list as one value, like Gradle's `--args`.
const joinArgsForTool = (args: ReadonlyArray<string>) =>
  args.map((arg) => (/[\s"']/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");

const StringOrArgs = Schema.Union([Schema.String, Schema.Array(Schema.String)]);

const decodeNodeFields = Schema.decodeUnknownOption(
  Schema.Struct({
    program: Schema.optionalKey(Schema.String),
    runtimeExecutable: Schema.optionalKey(Schema.String),
    runtime: Schema.optionalKey(Schema.String),
    runtimeArgs: Schema.optionalKey(StringOrArgs),
    args: Schema.optionalKey(StringOrArgs),
    command: Schema.optionalKey(Schema.String),
  }),
);

const nodeRecipe: LaunchRecipe = ({ type, config, cwd }) => {
  const fields = decodeNodeFields(config);
  if (Option.isNone(fields)) return invalidFields(type);
  const { program, command } = fields.value;
  if (type === "node-terminal") {
    return command
      ? { _tag: "shell", commandLine: command }
      : unsupported("Set `command` to the shell command to run.");
  }
  const runtimeArgs = toArgs(fields.value.runtimeArgs);
  if (program === undefined && runtimeArgs.length === 0) {
    return unsupported("Set `program`, or `runtimeArgs` to run a package script.");
  }
  const runtime =
    fields.value.runtimeExecutable ?? fields.value.runtime ?? (type === "bun" ? "bun" : "node");
  return exec(runtime, [
    ...runtimeArgs,
    ...(program === undefined ? [] : [relativeToCwd(program, cwd)]),
    ...toArgs(fields.value.args),
  ]);
};

const decodeDartFields = Schema.decodeUnknownOption(
  Schema.Struct({
    program: Schema.optionalKey(Schema.String),
    args: Schema.optionalKey(StringOrArgs),
    toolArgs: Schema.optionalKey(StringOrArgs),
    deviceId: Schema.optionalKey(Schema.String),
    flutterMode: Schema.optionalKey(Schema.Literals(["debug", "profile", "release"])),
  }),
);

const dartRecipe: LaunchRecipe = ({ type, config, cwd, facts }) => {
  const fields = decodeDartFields(config);
  if (Option.isNone(fields)) return invalidFields(type);
  const { program, deviceId, flutterMode = "debug" } = fields.value;
  const toolArgs = toArgs(fields.value.toolArgs);
  // Dart-Code passes `args` to the app and `toolArgs` to the flutter/dart tool.
  const appArgs = toArgs(fields.value.args);
  if (facts.isFlutterProject) {
    return exec(
      "flutter",
      [
        "run",
        `--${flutterMode}`,
        ...(deviceId === undefined ? [] : ["-d", deviceId]),
        ...(program === undefined ? [] : ["-t", relativeToCwd(program, cwd)]),
        ...toolArgs,
        ...appArgs.map((arg) => `--dart-entrypoint-args=${arg}`),
      ],
      // Profile and release builds are AOT-compiled and can't hot reload.
      { hotReload: flutterMode === "debug" },
    );
  }
  if (program === undefined) {
    return unsupported("Set `program` to the Dart entry point, like bin/main.dart.");
  }
  return exec("dart", ["run", ...toolArgs, relativeToCwd(program, cwd), ...appArgs]);
};

const decodeSwiftFields = Schema.decodeUnknownOption(
  Schema.Struct({
    program: Schema.optionalKey(Schema.String),
    target: Schema.optionalKey(Schema.String),
    configuration: Schema.optionalKey(Schema.Literals(["debug", "release"])),
    args: Schema.optionalKey(StringOrArgs),
  }),
);

const swiftRecipe: LaunchRecipe = ({ type, config, cwd }) => {
  const fields = decodeSwiftFields(config);
  if (Option.isNone(fields)) return invalidFields(type);
  const { program, target, configuration } = fields.value;
  const args = toArgs(fields.value.args);
  if (target !== undefined) {
    return exec("swift", [
      "run",
      ...(configuration === "release" ? ["-c", "release"] : []),
      target,
      ...args,
    ]);
  }
  if (program !== undefined) return exec(relativeToCwd(program, cwd), args);
  return unsupported("Set `target`, or `program` to the built executable.");
};

// CodeLLDB adds these so it can read cargo's artifact list; `cargo run` doesn't want them.
const CARGO_ARTIFACT_FLAGS = new Set(["--message-format=json", "--no-run"]);

const decodeNativeFields = Schema.decodeUnknownOption(
  Schema.Struct({
    program: Schema.optionalKey(Schema.String),
    args: Schema.optionalKey(StringOrArgs),
    cargo: Schema.optionalKey(
      Schema.Struct({ args: Schema.optionalKey(Schema.Array(Schema.String)) }),
    ),
    // cppdbg lists environment variables as name/value pairs.
    environment: Schema.optionalKey(
      Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
    ),
  }),
);

const nativeRecipe: LaunchRecipe = ({ type, config, cwd }) => {
  const fields = decodeNativeFields(config);
  if (Option.isNone(fields)) return invalidFields(type);
  const { program, cargo } = fields.value;
  const args = toArgs(fields.value.args);
  const env = Object.fromEntries(
    (fields.value.environment ?? []).map(({ name, value }) => [name, value]),
  );
  if (cargo !== undefined) {
    const [subcommand = "build", ...rest] = (cargo.args ?? []).filter(
      (arg) => !CARGO_ARTIFACT_FLAGS.has(arg),
    );
    const programArgs = args.length === 0 ? [] : ["--", ...args];
    if (subcommand === "build" || subcommand === "run") {
      return exec("cargo", ["run", ...rest, ...programArgs], { env });
    }
    if (subcommand === "test") return exec("cargo", ["test", ...rest, ...programArgs], { env });
    return unsupported(`The cargo "${subcommand}" command needs a debugger.`);
  }
  if (program !== undefined) return exec(relativeToCwd(program, cwd), args, { env });
  return unsupported("Set `program`, or a `cargo` block for Rust.");
};

const decodeGoFields = Schema.decodeUnknownOption(
  Schema.Struct({
    mode: Schema.optionalKey(Schema.String),
    program: Schema.optionalKey(Schema.String),
    args: Schema.optionalKey(StringOrArgs),
    buildFlags: Schema.optionalKey(StringOrArgs),
  }),
);

const goRecipe: LaunchRecipe = ({ type, config, cwd }) => {
  const fields = decodeGoFields(config);
  if (Option.isNone(fields)) return invalidFields(type);
  const { mode = "auto", program } = fields.value;
  if (program === undefined) return unsupported("Set `program` to the package or file to run.");
  const target = relativeToCwd(program, cwd);
  const args = toArgs(fields.value.args);
  const buildFlags = toArgs(fields.value.buildFlags);
  switch (mode) {
    case "auto":
    case "debug":
      return exec("go", ["run", ...buildFlags, target, ...args]);
    case "test":
      return exec("go", [
        "test",
        ...buildFlags,
        target,
        ...(args.length === 0 ? [] : ["-args", ...args]),
      ]);
    case "exec":
      return exec(target, args);
    default:
      return unsupported(`Go "${mode}" mode needs a debugger.`);
  }
};

const decodePythonFields = Schema.decodeUnknownOption(
  Schema.Struct({
    program: Schema.optionalKey(Schema.String),
    module: Schema.optionalKey(Schema.String),
    args: Schema.optionalKey(StringOrArgs),
    python: Schema.optionalKey(Schema.String),
    pythonArgs: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
);

const pythonRecipe: LaunchRecipe = ({ type, config, cwd, facts }) => {
  const fields = decodePythonFields(config);
  if (Option.isNone(fields)) return invalidFields(type);
  const { program, module } = fields.value;
  const interpreter = fields.value.python ?? (facts.platform === "win32" ? "python" : "python3");
  const pythonArgs = fields.value.pythonArgs ?? [];
  const args = toArgs(fields.value.args);
  if (module !== undefined) return exec(interpreter, [...pythonArgs, "-m", module, ...args]);
  if (program !== undefined) {
    return exec(interpreter, [...pythonArgs, relativeToCwd(program, cwd), ...args]);
  }
  return unsupported("Set `program` or `module`.");
};

const decodeJvmFields = Schema.decodeUnknownOption(
  Schema.Struct({
    mainClass: Schema.optionalKey(Schema.String),
    projectName: Schema.optionalKey(Schema.String),
    classPaths: Schema.optionalKey(Schema.Array(Schema.String)),
    vmArgs: Schema.optionalKey(StringOrArgs),
    args: Schema.optionalKey(StringOrArgs),
  }),
);

function gradleCommand(facts: LaunchWorkspaceFacts): string | null {
  if (facts.platform === "win32" && facts.markers.has("gradlew.bat")) return ".\\gradlew.bat";
  if (facts.platform !== "win32" && facts.markers.has("gradlew")) return "./gradlew";
  return facts.markers.has("build.gradle") || facts.markers.has("build.gradle.kts")
    ? "gradle"
    : null;
}

function mavenCommand(facts: LaunchWorkspaceFacts): string | null {
  if (facts.platform === "win32" && facts.markers.has("mvnw.cmd")) return ".\\mvnw.cmd";
  if (facts.platform !== "win32" && facts.markers.has("mvnw")) return "./mvnw";
  return facts.markers.has("pom.xml") ? "mvn" : null;
}

const jvmRecipe: LaunchRecipe = ({ type, config, facts }) => {
  const fields = decodeJvmFields(config);
  if (Option.isNone(fields)) return invalidFields(type);
  if (facts.isAndroidProject) return unsupported("Android app modules aren't supported yet.");
  const { mainClass, projectName } = fields.value;
  const args = toArgs(fields.value.args);
  const vmArgs = toArgs(fields.value.vmArgs);
  // `$Auto`, `$Runtime` and `!excluded` entries ask the Java extension to compute the classpath.
  const classPaths = (fields.value.classPaths ?? []).filter(
    (entry) => !entry.startsWith("$") && !entry.startsWith("!"),
  );
  if (mainClass !== undefined && classPaths.length > 0) {
    const delimiter = facts.platform === "win32" ? ";" : ":";
    return exec("java", [...vmArgs, "-cp", classPaths.join(delimiter), mainClass, ...args]);
  }
  const gradle = gradleCommand(facts);
  if (gradle !== null) {
    return exec(
      gradle,
      [
        projectName === undefined ? "run" : `:${projectName}:run`,
        ...(args.length === 0 ? [] : [`--args=${joinArgsForTool(args)}`]),
      ],
      {
        warnings:
          vmArgs.length === 0
            ? []
            : ["Gradle's run task ignores `vmArgs`. Set applicationDefaultJvmArgs instead."],
      },
    );
  }
  const maven = mavenCommand(facts);
  if (maven !== null && mainClass !== undefined) {
    return exec(
      maven,
      [
        "-q",
        "compile",
        "exec:java",
        `-Dexec.mainClass=${mainClass}`,
        ...(args.length === 0 ? [] : [`-Dexec.args=${joinArgsForTool(args)}`]),
      ],
      // exec:java runs inside Maven's JVM, so JVM flags go through MAVEN_OPTS.
      { env: vmArgs.length === 0 ? {} : { MAVEN_OPTS: joinArgsForTool(vmArgs) } },
    );
  }
  if (mainClass === undefined) return unsupported("Set `mainClass`.");
  return unsupported(
    "Add `classPaths`, or a Gradle or Maven build, so T3 can build the classpath.",
  );
};

const unsupportedType =
  (reason: string): LaunchRecipe =>
  () =>
    unsupported(reason);

const browserRecipe = unsupportedType(
  "Browser debugging isn't supported. Open the URL in the preview panel instead.",
);

/** Recipes keyed by the launch configuration `type` each VS Code extension registers. */
export const LAUNCH_RECIPES: ReadonlyMap<string, LaunchRecipe> = new Map<string, LaunchRecipe>([
  ["node", nodeRecipe],
  ["pwa-node", nodeRecipe],
  ["node-terminal", nodeRecipe],
  ["bun", nodeRecipe],
  ["dart", dartRecipe],
  ["swift", swiftRecipe],
  ["swift-lldb", swiftRecipe],
  ["lldb", nativeRecipe],
  ["lldb-dap", nativeRecipe],
  ["cppdbg", nativeRecipe],
  ["cppvsdbg", nativeRecipe],
  ["go", goRecipe],
  ["python", pythonRecipe],
  ["debugpy", pythonRecipe],
  ["java", jvmRecipe],
  ["kotlin", jvmRecipe],
  ["sweetpad-lldb", unsupportedType("Xcode app targets aren't supported yet.")],
  ["chrome", browserRecipe],
  ["pwa-chrome", browserRecipe],
  ["msedge", browserRecipe],
  ["pwa-msedge", browserRecipe],
]);
