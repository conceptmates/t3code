/**
 * The fields the Run & Debug form shows for each launch configuration type.
 * Anything else in a configuration stays editable in the JSON view.
 */

export type LaunchFormFieldKind = "text" | "list" | "choice" | "env";

export interface LaunchFormField {
  readonly key: string;
  readonly label: string;
  readonly kind: LaunchFormFieldKind;
  readonly placeholder?: string;
  readonly choices?: ReadonlyArray<string>;
}

const text = (key: string, label: string, placeholder?: string): LaunchFormField => ({
  key,
  label,
  kind: "text",
  ...(placeholder === undefined ? {} : { placeholder }),
});
const list = (key: string, label: string): LaunchFormField => ({ key, label, kind: "list" });
const choice = (key: string, label: string, choices: ReadonlyArray<string>): LaunchFormField => ({
  key,
  label,
  kind: "choice",
  choices,
});

const COMMON_FIELDS: ReadonlyArray<LaunchFormField> = [
  text("cwd", "Working directory", "${workspaceFolder}"),
  text("preLaunchTask", "Pre-launch task", "npm: build"),
  { key: "env", label: "Environment", kind: "env" },
  text("envFile", "Env file", "${workspaceFolder}/.env"),
];

const FIELDS_BY_TYPE: Record<string, ReadonlyArray<LaunchFormField>> = {
  node: [
    text("program", "Program", "${workspaceFolder}/src/index.js"),
    text("runtimeExecutable", "Runtime", "node"),
    list("runtimeArgs", "Runtime arguments"),
    list("args", "Arguments"),
  ],
  "node-terminal": [text("command", "Command", "npm run dev")],
  bun: [text("program", "Program", "index.ts"), list("args", "Arguments")],
  dart: [
    text("program", "Entry point", "lib/main.dart"),
    text("deviceId", "Device", "emulator-5554"),
    choice("flutterMode", "Flutter mode", ["debug", "profile", "release"]),
    list("args", "App arguments"),
    list("toolArgs", "Tool arguments"),
  ],
  swift: [
    text("target", "Target"),
    text("program", "Program", "${workspaceFolder}/.build/debug/App"),
    choice("configuration", "Configuration", ["debug", "release"]),
    list("args", "Arguments"),
  ],
  lldb: [text("program", "Program"), list("args", "Arguments")],
  cppdbg: [text("program", "Program"), list("args", "Arguments")],
  go: [
    text("program", "Package", "${workspaceFolder}"),
    choice("mode", "Mode", ["auto", "debug", "test", "exec"]),
    list("args", "Arguments"),
    text("buildFlags", "Build flags", "-tags dev"),
  ],
  python: [
    text("program", "Program", "${workspaceFolder}/main.py"),
    text("module", "Module", "uvicorn"),
    text("python", "Interpreter", "python3"),
    list("args", "Arguments"),
  ],
  java: [
    text("mainClass", "Main class", "com.example.Main"),
    text("projectName", "Project"),
    list("classPaths", "Class paths"),
    list("vmArgs", "JVM arguments"),
    list("args", "Arguments"),
  ],
  kotlin: [text("mainClass", "Main class", "MainKt"), list("args", "Arguments")],
};

const TYPE_ALIASES: Record<string, string> = {
  "pwa-node": "node",
  "swift-lldb": "swift",
  "lldb-dap": "lldb",
  cppvsdbg: "cppdbg",
  debugpy: "python",
};

export function launchFormFields(type: string): ReadonlyArray<LaunchFormField> {
  return [...(FIELDS_BY_TYPE[TYPE_ALIASES[type] ?? type] ?? []), ...COMMON_FIELDS];
}

/** List fields are edited one item per line; VS Code also accepts one string. */
export function formatListFieldValue(value: unknown): string {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join("\n");
  return typeof value === "string" ? value : "";
}

/** Blank input removes the field instead of writing an empty list. */
export function parseListFieldValue(input: string): Array<string> | undefined {
  const items = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return items.length === 0 ? undefined : items;
}

/** Environment fields are edited as KEY=VALUE lines. */
export function formatEnvFieldValue(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  return Object.entries(value)
    .flatMap(([key, entry]) => (typeof entry === "string" ? [`${key}=${entry}`] : []))
    .join("\n");
}

export function parseEnvFieldValue(input: string): Record<string, string> | undefined {
  const entries = input.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf("=");
    const key = separator === -1 ? line.trim() : line.slice(0, separator).trim();
    return key.length === 0 ? [] : [[key, separator === -1 ? "" : line.slice(separator + 1)]];
  });
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
