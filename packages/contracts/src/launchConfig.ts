import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Workspace-relative path of the VS Code launch configuration file. */
export const LAUNCH_JSON_RELATIVE_PATH = ".vscode/launch.json";

/** Workspace-relative path of the VS Code tasks file that `preLaunchTask` reads. */
export const TASKS_JSON_RELATIVE_PATH = ".vscode/tasks.json";

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

// Entries stay loosely typed at the file level so one malformed configuration
// or task doesn't hide the others. The server decodes each entry on its own.
export const LaunchJsonFile = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  configurations: Schema.optionalKey(Schema.Array(JsonObject)),
  compounds: Schema.optionalKey(Schema.Array(JsonObject)),
  inputs: Schema.optionalKey(Schema.Array(JsonObject)),
});
export type LaunchJsonFile = typeof LaunchJsonFile.Type;

export const TasksJsonFile = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  tasks: Schema.optionalKey(Schema.Array(JsonObject)),
});
export type TasksJsonFile = typeof TasksJsonFile.Type;

/** Environment overrides for a step. `null` unsets an inherited variable. */
const LaunchStepEnv = Schema.Record(Schema.String, Schema.NullOr(Schema.String));

export const LaunchRunStep = Schema.Union([
  Schema.TaggedStruct("exec", {
    label: Schema.String,
    command: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.String,
    env: LaunchStepEnv,
  }),
  Schema.TaggedStruct("shell", {
    label: Schema.String,
    commandLine: Schema.String,
    cwd: Schema.String,
    env: LaunchStepEnv,
  }),
]);
export type LaunchRunStep = typeof LaunchRunStep.Type;

export const LaunchInputPrompt = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["promptString", "pickString"]),
  description: Schema.NullOr(Schema.String),
  default: Schema.NullOr(Schema.String),
  options: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
  password: Schema.Boolean,
});
export type LaunchInputPrompt = typeof LaunchInputPrompt.Type;

export const LaunchConfigStatus = Schema.Union([
  /** Steps run in order: resolved preLaunchTask steps, then the launch itself. */
  Schema.TaggedStruct("runnable", { steps: Schema.Array(LaunchRunStep) }),
  Schema.TaggedStruct("needs-inputs", { inputIds: Schema.Array(Schema.String) }),
  Schema.TaggedStruct("missing-toolchain", { binary: Schema.String }),
  Schema.TaggedStruct("unsupported", { reason: Schema.String }),
]);
export type LaunchConfigStatus = typeof LaunchConfigStatus.Type;

export const LaunchConfigEntry = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["configuration", "compound"]),
  type: Schema.NullOr(Schema.String),
  request: Schema.NullOr(Schema.String),
  /** Member configuration names for a compound, in launch order. */
  configurations: Schema.Array(Schema.String),
  /** The process accepts `r` (hot reload) and `R` (hot restart) on stdin. */
  hotReload: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
  status: LaunchConfigStatus,
});
export type LaunchConfigEntry = typeof LaunchConfigEntry.Type;

export const LaunchFileStatus = Schema.Union([
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("invalid", { message: Schema.String }),
  Schema.TaggedStruct("valid", {}),
]);
export type LaunchFileStatus = typeof LaunchFileStatus.Type;

export const LaunchListConfigsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Values for `${input:id}` variables, collected by the client before a run. */
  inputValues: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type LaunchListConfigsInput = typeof LaunchListConfigsInput.Type;

export const LaunchListConfigsResult = Schema.Struct({
  launchFile: LaunchFileStatus,
  entries: Schema.Array(LaunchConfigEntry),
  inputs: Schema.Array(LaunchInputPrompt),
  /** Problems that don't belong to one entry, like an invalid tasks.json. */
  warnings: Schema.Array(Schema.String),
});
export type LaunchListConfigsResult = typeof LaunchListConfigsResult.Type;

/**
 * Terminal id for a launch session. It's derived from the entry name, so every
 * client finds the same terminal and running an entry again restarts it.
 */
export function launchTerminalId(name: string): string {
  let hash = 0x811c9dc5;
  for (const char of name) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = hash.toString(16).padStart(8, "0");
  return slug.length === 0 ? `launch-${suffix}` : `launch-${slug}-${suffix}`;
}

export const LaunchRunInput = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  worktreePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  name: TrimmedNonEmptyString,
  /** Values for `${input:id}` variables, collected by the client before the run. */
  inputValues: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type LaunchRunInput = typeof LaunchRunInput.Type;

export const LaunchSession = Schema.Struct({
  name: Schema.String,
  terminalId: Schema.String,
  /** `preLaunch` runs a compound's preLaunchTask; its configurations start after it succeeds. */
  role: Schema.Literals(["preLaunch", "configuration"]),
});
export type LaunchSession = typeof LaunchSession.Type;

export const LaunchRunResult = Schema.Struct({
  sessions: Schema.Array(LaunchSession),
});
export type LaunchRunResult = typeof LaunchRunResult.Type;

export const LaunchStopInput = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  terminalId: TrimmedNonEmptyString,
});
export type LaunchStopInput = typeof LaunchStopInput.Type;

export const LaunchStarter = Schema.Struct({
  label: Schema.String,
  description: Schema.String,
  /** A launch.json configuration object, written as-is into `configurations`. */
  configuration: Schema.Record(Schema.String, Schema.Unknown),
});
export type LaunchStarter = typeof LaunchStarter.Type;

export const LaunchStartersInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type LaunchStartersInput = typeof LaunchStartersInput.Type;

export const LaunchStartersResult = Schema.Struct({
  starters: Schema.Array(LaunchStarter),
});
export type LaunchStartersResult = typeof LaunchStartersResult.Type;

export class LaunchRunError extends Schema.TaggedError<LaunchRunError>()("LaunchRunError", {
  name: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class LaunchStopError extends Schema.TaggedError<LaunchStopError>()("LaunchStopError", {
  terminalId: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class LaunchListConfigsError extends Schema.TaggedError<LaunchListConfigsError>()(
  "LaunchListConfigsError",
  {
    cwd: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
