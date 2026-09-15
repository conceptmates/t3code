/**
 * Resolves a `preLaunchTask` label into steps. Tasks defined in
 * .vscode/tasks.json win; after that come labels VS Code extensions provide
 * without a tasks.json entry, like `npm: build` or `swift: Build Debug App`.
 *
 * @module launchTasks
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isPathLikeCommand, splitLaunchArgs, type LaunchWorkspaceFacts } from "./launchRecipes.ts";
import { substituteLaunchVariables, type LaunchVariableContext } from "./launchVariables.ts";

type StepEnv = Readonly<Record<string, string | null>>;

export type PlannedLaunchStep =
  | {
      readonly _tag: "exec";
      readonly label: string;
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly cwd: string;
      readonly env: StepEnv;
      /** Binary that must be on PATH, or null when `command` is a path. */
      readonly requires: string | null;
      /** Absolute path of a dotenv file whose variables sit beneath `env`. */
      readonly envFile: string | null;
    }
  | {
      readonly _tag: "shell";
      readonly label: string;
      readonly commandLine: string;
      readonly cwd: string;
      readonly env: StepEnv;
      readonly envFile: string | null;
    };

export interface LaunchTaskContext {
  readonly tasks: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly variables: LaunchVariableContext;
  /** Facts for the workspace root, used to pick the package manager. */
  readonly rootFacts: LaunchWorkspaceFacts;
}

export type LaunchTaskResolution =
  | {
      readonly _tag: "steps";
      readonly steps: ReadonlyArray<PlannedLaunchStep>;
      readonly warnings: ReadonlyArray<string>;
      readonly unsupportedVariables: ReadonlyArray<string>;
      readonly missingInputs: ReadonlyArray<string>;
    }
  | { readonly _tag: "skipped"; readonly warning: string };

const TaskValue = Schema.Union([Schema.String, Schema.Struct({ value: Schema.String })]);

const TaskFields = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(TaskValue),
  args: Schema.optionalKey(Schema.Array(TaskValue)),
  script: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  isBackground: Schema.optionalKey(Schema.Boolean),
  dependsOn: Schema.optionalKey(Schema.Unknown),
  options: Schema.optionalKey(
    Schema.Struct({
      cwd: Schema.optionalKey(Schema.String),
      env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
});
type TaskFields = typeof TaskFields.Type;

const decodeTaskFields = Schema.decodeUnknownOption(TaskFields);

const taskValue = (value: typeof TaskValue.Type) =>
  typeof value === "string" ? value : value.value;

function taskLabel(task: TaskFields): string | undefined {
  if (task.label !== undefined) return task.label;
  if (task.type === "npm" && task.script !== undefined) {
    return task.path === undefined ? `npm: ${task.script}` : `npm: ${task.script} - ${task.path}`;
  }
  return undefined;
}

export function packageManager(facts: LaunchWorkspaceFacts): "bun" | "pnpm" | "yarn" | "npm" {
  if (facts.markers.has("bun.lock") || facts.markers.has("bun.lockb")) return "bun";
  if (facts.markers.has("pnpm-lock.yaml")) return "pnpm";
  if (facts.markers.has("yarn.lock")) return "yarn";
  return "npm";
}

const PACKAGE_EXEC = {
  bun: ["bunx"],
  pnpm: ["pnpm", "exec"],
  yarn: ["yarn"],
  npm: ["npx"],
} as const;

/** POSIX shell quoting for the arguments of a `shell` task. */
export function quoteShellArg(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

const execStep = (
  label: string,
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  env: StepEnv = {},
): PlannedLaunchStep => ({
  _tag: "exec",
  label,
  command,
  args,
  cwd,
  env,
  requires: isPathLikeCommand(command) ? null : command,
  envFile: null,
});

const singleStep = (step: PlannedLaunchStep): LaunchTaskResolution => ({
  _tag: "steps",
  steps: [step],
  warnings: [],
  unsupportedVariables: [],
  missingInputs: [],
});

const skipped = (warning: string): LaunchTaskResolution => ({ _tag: "skipped", warning });

function definedTaskStep(
  label: string,
  task: TaskFields,
  context: LaunchTaskContext,
): PlannedLaunchStep | null {
  const root = context.variables.workspaceFolder;
  const cwd =
    task.options?.cwd === undefined ? root : context.variables.resolvePath(root, task.options.cwd);
  const env = task.options?.env ?? {};
  const command = task.command === undefined ? undefined : taskValue(task.command);
  const args = (task.args ?? []).map(taskValue);
  switch (task.type ?? "shell") {
    case "npm":
      return task.script === undefined
        ? null
        : execStep(
            label,
            packageManager(context.rootFacts),
            ["run", task.script],
            task.path === undefined ? cwd : context.variables.resolvePath(root, task.path),
            env,
          );
    case "shell":
      // The command is already a shell line; only the separate args need quoting.
      return command === undefined
        ? null
        : {
            _tag: "shell",
            label,
            commandLine: [command, ...args.map(quoteShellArg)].join(" "),
            cwd,
            env,
            envFile: null,
          };
    case "process":
      return command === undefined ? null : execStep(label, command, args, cwd, env);
    case "cargo":
      return command === undefined ? null : execStep(label, "cargo", [command, ...args], cwd, env);
    case "swift":
      return execStep(label, "swift", args, cwd, env);
    case "flutter":
    case "dart":
      return execStep(label, command ?? task.type ?? "flutter", args, cwd, env);
    default:
      return null;
  }
}

const NPM_TASK_LABEL = /^npm: (.+?)(?: - (.+))?$/;
const SWIFT_BUILD_LABEL = /^swift: Build (Debug|Release) (.+)$/;
const SWIFT_BUILD_ALL_LABEL = /^swift: Build All\b/;
const CARGO_TASK_LABEL = /^(?:rust: )?cargo (.+)$/;
const TSC_TASK_LABEL = /^tsc: (build|watch) - (.+)$/;

function resolveProviderTask(
  label: string,
  context: LaunchTaskContext,
): LaunchTaskResolution | null {
  const root = context.variables.workspaceFolder;

  const npm = NPM_TASK_LABEL.exec(label);
  if (npm?.[1] !== undefined) {
    const cwd = npm[2] === undefined ? root : context.variables.resolvePath(root, npm[2]);
    return singleStep(execStep(label, packageManager(context.rootFacts), ["run", npm[1]], cwd));
  }

  const swiftBuild = SWIFT_BUILD_LABEL.exec(label);
  if (swiftBuild?.[2] !== undefined) {
    const release = swiftBuild[1] === "Release" ? ["-c", "release"] : [];
    return singleStep(
      execStep(label, "swift", ["build", ...release, "--product", swiftBuild[2]], root),
    );
  }
  if (SWIFT_BUILD_ALL_LABEL.test(label)) {
    return singleStep(execStep(label, "swift", ["build"], root));
  }

  const cargo = CARGO_TASK_LABEL.exec(label);
  if (cargo?.[1] !== undefined) {
    return singleStep(execStep(label, "cargo", splitLaunchArgs(cargo[1]), root));
  }

  const tsc = TSC_TASK_LABEL.exec(label);
  if (tsc?.[2] !== undefined) {
    if (tsc[1] === "watch") {
      return skipped(`preLaunchTask "${label}" runs in the background, so it was skipped.`);
    }
    const [command, ...execArgs] = PACKAGE_EXEC[packageManager(context.rootFacts)];
    return singleStep(execStep(label, command, [...execArgs, "tsc", "-p", tsc[2]], root));
  }

  return null;
}

export function resolvePreLaunchTask(
  label: string,
  context: LaunchTaskContext,
): LaunchTaskResolution {
  for (const raw of context.tasks) {
    const declared = decodeTaskFields(raw);
    if (Option.isNone(declared) || taskLabel(declared.value) !== label) continue;
    if (declared.value.isBackground === true) {
      return skipped(`preLaunchTask "${label}" runs in the background, so it was skipped.`);
    }
    const substitution = substituteLaunchVariables(raw, context.variables);
    const task = decodeTaskFields(substitution.value);
    const step = Option.isSome(task) ? definedTaskStep(label, task.value, context) : null;
    if (step === null) {
      return skipped(`T3 can't run preLaunchTask "${label}", so it was skipped.`);
    }
    return {
      _tag: "steps",
      steps: [step],
      warnings:
        declared.value.dependsOn === undefined
          ? []
          : [`dependsOn in task "${label}" isn't supported, so only that task runs.`],
      unsupportedVariables: substitution.unsupported,
      missingInputs: substitution.missingInputs,
    };
  }
  return (
    resolveProviderTask(label, context) ??
    skipped(`preLaunchTask "${label}" isn't defined in tasks.json, so it was skipped.`)
  );
}
