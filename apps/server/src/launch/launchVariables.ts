/**
 * VS Code-style `${…}` substitution for launch.json and tasks.json values.
 *
 * Only variables that mean something on a server without an editor resolve.
 * Editor-bound ones such as `${file}` or `${command:…}` are reported as
 * unsupported so the configuration can say why it can't run.
 *
 * @module launchVariables
 */

export interface LaunchVariableContext {
  readonly workspaceFolder: string;
  readonly userHome: string;
  readonly pathSeparator: string;
  /** Resolves `target` against `base`, like the Effect `Path` service's `resolve`. */
  readonly resolvePath: (base: string, target: string) => string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly inputValues: Readonly<Record<string, string>>;
}

export interface LaunchSubstitution {
  readonly value: unknown;
  /** Variable names without `${}`, like `file` or `command:python.interpreterPath`. */
  readonly unsupported: ReadonlyArray<string>;
  /** `${input:id}` ids that have no value yet. */
  readonly missingInputs: ReadonlyArray<string>;
}

type VariableValue =
  | { readonly _tag: "value"; readonly value: string }
  | { readonly _tag: "input"; readonly id: string }
  | { readonly _tag: "unsupported" };

const VARIABLE_PATTERN = /\$\{([^}]+)\}/g;

export const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pathBasename = (path: string) =>
  path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path;

const resolved = (value: string): VariableValue => ({ _tag: "value", value });

function resolveVariable(name: string, context: LaunchVariableContext): VariableValue {
  // Single-root workspaces only: `${workspaceFolder:Name}`, which the Swift
  // extension writes, names the workspace itself.
  if (
    name === "workspaceFolder" ||
    name === "workspaceRoot" ||
    name === "cwd" ||
    name.startsWith("workspaceFolder:")
  ) {
    return resolved(context.workspaceFolder);
  }
  if (name === "workspaceFolderBasename") return resolved(pathBasename(context.workspaceFolder));
  if (name === "userHome") return resolved(context.userHome);
  if (name === "pathSeparator" || name === "/") return resolved(context.pathSeparator);
  if (name.startsWith("env:")) return resolved(context.env[name.slice("env:".length)] ?? "");
  if (name.startsWith("input:")) {
    const id = name.slice("input:".length);
    const value = context.inputValues[id];
    return value === undefined ? { _tag: "input", id } : resolved(value);
  }
  return { _tag: "unsupported" };
}

/** Substitutes variables in every string inside `value`, leaving unresolved ones in place. */
export function substituteLaunchVariables(
  value: unknown,
  context: LaunchVariableContext,
): LaunchSubstitution {
  const unsupported = new Set<string>();
  const missingInputs = new Set<string>();

  const substituteString = (input: string) =>
    input.replace(VARIABLE_PATTERN, (match, name: string) => {
      const variable = resolveVariable(name, context);
      switch (variable._tag) {
        case "value":
          return variable.value;
        case "input":
          missingInputs.add(variable.id);
          return match;
        case "unsupported":
          unsupported.add(name);
          return match;
      }
    });

  const visit = (current: unknown): unknown => {
    if (typeof current === "string") return substituteString(current);
    if (Array.isArray(current)) return current.map(visit);
    if (isJsonObject(current)) {
      return Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, visit(entry)]));
    }
    return current;
  };

  return {
    value: visit(value),
    unsupported: [...unsupported],
    missingInputs: [...missingInputs],
  };
}
