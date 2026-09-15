/**
 * Resolves a whole .vscode/launch.json into entries, as pure passes around the
 * server's I/O:
 *
 * 1. `collectLaunchCwds` lists the working directories to gather facts for.
 * 2. `resolveLaunchFile` plans every configuration and compound.
 * 3. After toolchain checks and envFile reads, `finalizeLaunchEntries`
 *    produces the entries sent to clients.
 *
 * @module launchResolution
 */
import type {
  LaunchConfigEntry,
  LaunchConfigStatus,
  LaunchInputPrompt,
  LaunchJsonFile,
  LaunchRunStep,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  LAUNCH_RECIPES,
  emptyLaunchWorkspaceFacts,
  type LaunchWorkspaceFacts,
} from "./launchRecipes.ts";
import {
  resolvePreLaunchTask,
  type LaunchTaskContext,
  type PlannedLaunchStep,
} from "./launchTasks.ts";
import {
  isJsonObject,
  substituteLaunchVariables,
  type LaunchVariableContext,
} from "./launchVariables.ts";

export interface LaunchResolutionContext {
  readonly launchFile: LaunchJsonFile;
  readonly tasks: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly variables: LaunchVariableContext;
  readonly platform: NodeJS.Platform;
}

export type LaunchPlan =
  | {
      readonly _tag: "steps";
      readonly steps: ReadonlyArray<PlannedLaunchStep>;
      readonly missingInputs: ReadonlyArray<string>;
    }
  | { readonly _tag: "unsupported"; readonly reason: string };

export interface ResolvedLaunchEntry {
  readonly name: string;
  readonly kind: "configuration" | "compound";
  readonly type: string | null;
  readonly request: string | null;
  readonly configurations: ReadonlyArray<string>;
  readonly hotReload: boolean;
  readonly warnings: ReadonlyArray<string>;
  readonly plan: LaunchPlan;
}

export interface ResolvedLaunchFile {
  readonly entries: ReadonlyArray<ResolvedLaunchEntry>;
  readonly inputs: ReadonlyArray<LaunchInputPrompt>;
  readonly warnings: ReadonlyArray<string>;
}

export interface LaunchFinalizeContext {
  readonly availableBinaries: ReadonlySet<string>;
  /** Parsed envFile contents keyed by absolute path. Missing keys weren't readable. */
  readonly envFiles: ReadonlyMap<string, Readonly<Record<string, string>>>;
}

const decodeBaseFields = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.String,
    type: Schema.String,
    request: Schema.optionalKey(Schema.String),
    cwd: Schema.optionalKey(Schema.String),
    env: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
    envFile: Schema.optionalKey(Schema.String),
    preLaunchTask: Schema.optionalKey(Schema.String),
  }),
);

const decodeCompoundFields = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.String,
    configurations: Schema.Array(
      Schema.Union([Schema.String, Schema.Struct({ name: Schema.String })]),
    ),
    preLaunchTask: Schema.optionalKey(Schema.String),
  }),
);

const decodeInputFields = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String,
    type: Schema.String,
    description: Schema.optionalKey(Schema.String),
    default: Schema.optionalKey(Schema.String),
    options: Schema.optionalKey(
      Schema.Array(
        Schema.Union([
          Schema.String,
          Schema.Struct({ label: Schema.optionalKey(Schema.String), value: Schema.String }),
        ]),
      ),
    ),
    password: Schema.optionalKey(Schema.Boolean),
  }),
);

const PLATFORM_OVERRIDE_KEYS = new Set(["osx", "windows", "linux"]);

const platformOverrideKey = (platform: NodeJS.Platform) =>
  platform === "darwin" ? "osx" : platform === "win32" ? "windows" : "linux";

/** Applies the `osx` / `windows` / `linux` block for the server's platform. */
function applyPlatformOverride(
  config: Readonly<Record<string, unknown>>,
  platform: NodeJS.Platform,
): Record<string, unknown> {
  const base = Object.fromEntries(
    Object.entries(config).filter(([key]) => !PLATFORM_OVERRIDE_KEYS.has(key)),
  );
  const override = config[platformOverrideKey(platform)];
  return isJsonObject(override) ? { ...base, ...override } : base;
}

type PreparedConfiguration =
  | { readonly _tag: "invalid"; readonly name: string }
  | {
      readonly _tag: "prepared";
      readonly name: string;
      readonly config: Record<string, unknown>;
      readonly type: string;
      readonly request: string | undefined;
      readonly env: Readonly<Record<string, string | null>>;
      readonly envFile: string | undefined;
      readonly preLaunchTask: string | undefined;
      readonly cwd: string;
      readonly unsupportedVariables: ReadonlyArray<string>;
      readonly missingInputs: ReadonlyArray<string>;
    };

function prepareConfiguration(
  raw: Readonly<Record<string, unknown>>,
  index: number,
  context: LaunchResolutionContext,
): PreparedConfiguration {
  const merged = applyPlatformOverride(raw, context.platform);
  const name =
    typeof merged.name === "string" && merged.name.length > 0
      ? merged.name
      : `Configuration ${index + 1}`;
  const substitution = substituteLaunchVariables(merged, context.variables);
  const config = isJsonObject(substitution.value) ? substitution.value : {};
  const base = decodeBaseFields(config);
  if (Option.isNone(base)) return { _tag: "invalid", name };
  const workspaceFolder = context.variables.workspaceFolder;
  return {
    _tag: "prepared",
    name,
    config,
    type: base.value.type,
    request: base.value.request,
    env: base.value.env ?? {},
    envFile: base.value.envFile,
    preLaunchTask: base.value.preLaunchTask,
    cwd:
      base.value.cwd === undefined
        ? workspaceFolder
        : context.variables.resolvePath(workspaceFolder, base.value.cwd),
    unsupportedVariables: substitution.unsupported,
    missingInputs: substitution.missingInputs,
  };
}

/** Working directories whose facts the recipes need, workspace root first. */
export function collectLaunchCwds(context: LaunchResolutionContext): Array<string> {
  const cwds = new Set([context.variables.workspaceFolder]);
  (context.launchFile.configurations ?? []).forEach((raw, index) => {
    const prepared = prepareConfiguration(raw, index, context);
    if (prepared._tag === "prepared") cwds.add(prepared.cwd);
  });
  return [...cwds];
}

const unsupportedPlan = (reason: string): LaunchPlan => ({ _tag: "unsupported", reason });

const unsupportedVariablesReason = (variables: ReadonlyArray<string>) =>
  `Uses ${variables.map((variable) => `\${${variable}}`).join(", ")}, which T3 can't resolve outside an editor.`;

const union = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) => [
  ...new Set([...left, ...right]),
];

interface PlanWithTask {
  readonly plan: LaunchPlan;
  readonly warnings: ReadonlyArray<string>;
}

/** Puts the resolved `preLaunchTask` steps in front of `steps`. */
function withPreLaunchTask(
  label: string | undefined,
  steps: ReadonlyArray<PlannedLaunchStep>,
  missingInputs: ReadonlyArray<string>,
  taskContext: LaunchTaskContext,
): PlanWithTask {
  if (label === undefined) return { plan: { _tag: "steps", steps, missingInputs }, warnings: [] };
  const task = resolvePreLaunchTask(label, taskContext);
  if (task._tag === "skipped") {
    return { plan: { _tag: "steps", steps, missingInputs }, warnings: [task.warning] };
  }
  if (task.unsupportedVariables.length > 0) {
    return {
      plan: unsupportedPlan(unsupportedVariablesReason(task.unsupportedVariables)),
      warnings: [],
    };
  }
  return {
    plan: {
      _tag: "steps",
      steps: [...task.steps, ...steps],
      missingInputs: union(missingInputs, task.missingInputs),
    },
    warnings: task.warnings,
  };
}

function resolveConfiguration(
  prepared: PreparedConfiguration,
  factsFor: (cwd: string) => LaunchWorkspaceFacts,
  taskContext: LaunchTaskContext,
): ResolvedLaunchEntry {
  if (prepared._tag === "invalid") {
    return {
      name: prepared.name,
      kind: "configuration",
      type: null,
      request: null,
      configurations: [],
      hotReload: false,
      warnings: [],
      plan: unsupportedPlan("Configurations need a string `name` and `type`."),
    };
  }
  const entry = {
    name: prepared.name,
    kind: "configuration",
    type: prepared.type,
    request: prepared.request ?? null,
    configurations: [],
    hotReload: false,
    warnings: [],
  } as const;

  if (prepared.request === "attach") {
    return {
      ...entry,
      plan: unsupportedPlan("Attach configurations need a debugger, which T3 doesn't have yet."),
    };
  }
  const recipe = LAUNCH_RECIPES.get(prepared.type);
  if (recipe === undefined) {
    return {
      ...entry,
      plan: unsupportedPlan(`T3 can't run "${prepared.type}" configurations yet.`),
    };
  }
  if (prepared.unsupportedVariables.length > 0) {
    return {
      ...entry,
      plan: unsupportedPlan(unsupportedVariablesReason(prepared.unsupportedVariables)),
    };
  }

  const result = recipe({
    type: prepared.type,
    config: prepared.config,
    cwd: prepared.cwd,
    facts: factsFor(prepared.cwd),
  });
  if (result._tag === "unsupported") return { ...entry, plan: result };

  const envFile =
    prepared.envFile === undefined
      ? null
      : taskContext.variables.resolvePath(taskContext.variables.workspaceFolder, prepared.envFile);
  const launchStep: PlannedLaunchStep =
    result._tag === "exec"
      ? {
          _tag: "exec",
          label: prepared.name,
          command: result.command,
          args: result.args,
          cwd: prepared.cwd,
          // Configuration env wins over variables the recipe sets.
          env: { ...result.env, ...prepared.env },
          requires: result.requires,
          envFile,
        }
      : {
          _tag: "shell",
          label: prepared.name,
          commandLine: result.commandLine,
          cwd: prepared.cwd,
          env: prepared.env,
          envFile,
        };
  const { plan, warnings } = withPreLaunchTask(
    prepared.preLaunchTask,
    [launchStep],
    prepared.missingInputs,
    taskContext,
  );
  return {
    ...entry,
    hotReload: result._tag === "exec" && result.hotReload,
    warnings: [...(result._tag === "exec" ? result.warnings : []), ...warnings],
    plan,
  };
}

function resolveCompound(
  raw: Readonly<Record<string, unknown>>,
  index: number,
  taskContext: LaunchTaskContext,
): ResolvedLaunchEntry {
  const decoded = decodeCompoundFields(raw);
  const entry = {
    kind: "compound",
    type: null,
    request: null,
    hotReload: false,
  } as const;
  if (Option.isNone(decoded)) {
    return {
      ...entry,
      name: typeof raw.name === "string" ? raw.name : `Compound ${index + 1}`,
      configurations: [],
      warnings: [],
      plan: unsupportedPlan("Compounds need a `name` and a `configurations` list."),
    };
  }
  const { plan, warnings } = withPreLaunchTask(decoded.value.preLaunchTask, [], [], taskContext);
  return {
    ...entry,
    name: decoded.value.name,
    configurations: decoded.value.configurations.map((member) =>
      typeof member === "string" ? member : member.name,
    ),
    warnings,
    plan,
  };
}

function decodeInputs(raw: ReadonlyArray<Readonly<Record<string, unknown>>>) {
  const inputs: Array<LaunchInputPrompt> = [];
  const warnings: Array<string> = [];
  for (const entry of raw) {
    const decoded = decodeInputFields(entry);
    if (Option.isNone(decoded)) {
      warnings.push('An entry in "inputs" is invalid.');
      continue;
    }
    const input = decoded.value;
    if (input.type !== "promptString" && input.type !== "pickString") {
      warnings.push(`Input "${input.id}" has type "${input.type}", which T3 doesn't support.`);
      continue;
    }
    inputs.push({
      id: input.id,
      type: input.type,
      description: input.description ?? null,
      default: input.default ?? null,
      options: (input.options ?? []).map((option) =>
        typeof option === "string"
          ? { label: option, value: option }
          : { label: option.label ?? option.value, value: option.value },
      ),
      password: input.password ?? false,
    });
  }
  return { inputs, warnings };
}

export function resolveLaunchFile(
  context: LaunchResolutionContext & {
    readonly factsByCwd: ReadonlyMap<string, LaunchWorkspaceFacts>;
  },
): ResolvedLaunchFile {
  const factsFor = (cwd: string) =>
    context.factsByCwd.get(cwd) ?? emptyLaunchWorkspaceFacts(context.platform);
  const taskContext: LaunchTaskContext = {
    tasks: context.tasks,
    variables: context.variables,
    rootFacts: factsFor(context.variables.workspaceFolder),
  };
  const configurations = (context.launchFile.configurations ?? []).map((raw, index) =>
    resolveConfiguration(prepareConfiguration(raw, index, context), factsFor, taskContext),
  );
  const compounds = (context.launchFile.compounds ?? []).map((raw, index) =>
    resolveCompound(raw, index, taskContext),
  );
  const { inputs, warnings } = decodeInputs(context.launchFile.inputs ?? []);
  return { entries: [...configurations, ...compounds], inputs, warnings };
}

const plannedSteps = (entries: ReadonlyArray<ResolvedLaunchEntry>) =>
  entries.flatMap((entry) => (entry.plan._tag === "steps" ? entry.plan.steps : []));

/** Binaries every planned step expects on PATH. */
export const collectRequiredBinaries = (entries: ReadonlyArray<ResolvedLaunchEntry>) => [
  ...new Set(
    plannedSteps(entries).flatMap((step) =>
      step._tag === "exec" && step.requires !== null ? [step.requires] : [],
    ),
  ),
];

/** Absolute envFile paths the planned steps read. */
export const collectEnvFiles = (entries: ReadonlyArray<ResolvedLaunchEntry>) => [
  ...new Set(
    plannedSteps(entries).flatMap((step) => (step.envFile === null ? [] : [step.envFile])),
  ),
];

/** Parses a dotenv file the way VS Code's `envFile` does. */
export function parseEnvFile(contents: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] === undefined) continue;
    const value = match[2] ?? "";
    const quote = value.length >= 2 && value[0] === value.at(-1) ? value[0] : undefined;
    env[match[1]] =
      quote === '"'
        ? value.slice(1, -1).replaceAll("\\n", "\n")
        : quote === "'"
          ? value.slice(1, -1)
          : value;
  }
  return env;
}

function toRunStep(step: PlannedLaunchStep, io: LaunchFinalizeContext): LaunchRunStep {
  const env = {
    ...(step.envFile === null ? {} : io.envFiles.get(step.envFile)),
    ...step.env,
  };
  return step._tag === "exec"
    ? {
        _tag: "exec",
        label: step.label,
        command: step.command,
        args: step.args,
        cwd: step.cwd,
        env,
      }
    : { _tag: "shell", label: step.label, commandLine: step.commandLine, cwd: step.cwd, env };
}

function stepsStatus(
  steps: ReadonlyArray<PlannedLaunchStep>,
  missingInputs: ReadonlyArray<string>,
  io: LaunchFinalizeContext,
): LaunchConfigStatus {
  for (const step of steps) {
    if (
      step._tag === "exec" &&
      step.requires !== null &&
      !io.availableBinaries.has(step.requires)
    ) {
      return { _tag: "missing-toolchain", binary: step.requires };
    }
  }
  if (missingInputs.length > 0) return { _tag: "needs-inputs", inputIds: missingInputs };
  return { _tag: "runnable", steps: steps.map((step) => toRunStep(step, io)) };
}

function compoundStatus(
  entry: ResolvedLaunchEntry,
  configurations: ReadonlyMap<string, LaunchConfigEntry>,
  io: LaunchFinalizeContext,
): LaunchConfigStatus {
  if (entry.plan._tag === "unsupported") return entry.plan;
  if (entry.configurations.length === 0) {
    return { _tag: "unsupported", reason: "This compound has no configurations." };
  }
  let missingInputs = entry.plan.missingInputs;
  for (const name of entry.configurations) {
    const member = configurations.get(name);
    if (member === undefined) {
      return { _tag: "unsupported", reason: `Configuration "${name}" doesn't exist.` };
    }
    switch (member.status._tag) {
      case "unsupported":
        return { _tag: "unsupported", reason: `"${name}": ${member.status.reason}` };
      case "missing-toolchain":
        return member.status;
      case "needs-inputs":
        missingInputs = union(missingInputs, member.status.inputIds);
        break;
      case "runnable":
        break;
    }
  }
  return stepsStatus(entry.plan.steps, missingInputs, io);
}

export function finalizeLaunchEntries(
  entries: ReadonlyArray<ResolvedLaunchEntry>,
  io: LaunchFinalizeContext,
): Array<LaunchConfigEntry> {
  const configurations = new Map<string, LaunchConfigEntry>();
  const finalize = (entry: ResolvedLaunchEntry): LaunchConfigEntry => {
    const status =
      entry.kind === "compound"
        ? compoundStatus(entry, configurations, io)
        : entry.plan._tag === "unsupported"
          ? entry.plan
          : stepsStatus(entry.plan.steps, entry.plan.missingInputs, io);
    const missingEnvFiles =
      entry.plan._tag === "steps"
        ? entry.plan.steps.flatMap((step) =>
            step.envFile !== null && !io.envFiles.has(step.envFile)
              ? [`envFile ${step.envFile} couldn't be read.`]
              : [],
          )
        : [];
    return {
      name: entry.name,
      kind: entry.kind,
      type: entry.type,
      request: entry.request,
      configurations: entry.configurations,
      hotReload: entry.hotReload,
      warnings: [...entry.warnings, ...missingEnvFiles],
      status,
    };
  };
  // Compounds come after configurations, so their members are already finalized.
  return entries.map((entry) => {
    const finalized = finalize(entry);
    if (entry.kind === "configuration" && !configurations.has(entry.name)) {
      configurations.set(entry.name, finalized);
    }
    return finalized;
  });
}
