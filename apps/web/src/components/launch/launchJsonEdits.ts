/**
 * Edits to `.vscode/launch.json` that keep the user's comments and formatting.
 * Every function returns the new file text, or null when the current text
 * isn't a JSON object, since editing it would corrupt the file.
 */
import { applyEdits, modify, parse, type FormattingOptions, type ParseError } from "jsonc-parser";

const FORMATTING_OPTIONS: FormattingOptions = { tabSize: 2, insertSpaces: true, eol: "\n" };

/** The file "Add configuration" creates when there is none, as VS Code writes it. */
export const NEW_LAUNCH_JSON = `{
  // Use IntelliSense to learn about possible attributes.
  // See https://go.microsoft.com/fwlink/?linkid=830387
  "version": "0.2.0",
  "configurations": []
}
`;

type JsonPath = ReadonlyArray<string | number>;

function parseLaunchJsonObject(contents: string): Record<string, unknown> | null {
  const errors: Array<ParseError> = [];
  const root: unknown = parse(contents, errors, { allowTrailingComma: true });
  if (errors.length > 0 || typeof root !== "object" || root === null || Array.isArray(root)) {
    return null;
  }
  return Object.fromEntries(Object.entries(root));
}

function edit(contents: string, path: JsonPath, value: unknown, isArrayInsertion = false) {
  return applyEdits(
    contents,
    modify(contents, [...path], value, { formattingOptions: FORMATTING_OPTIONS, isArrayInsertion }),
  );
}

/** Configuration objects as written in the file (before variable substitution). */
export function readLaunchConfigurations(contents: string): Array<Record<string, unknown>> | null {
  const root = parseLaunchJsonObject(contents);
  if (root === null) return null;
  const configurations = root.configurations;
  if (!Array.isArray(configurations)) return [];
  return configurations.map((configuration: unknown) =>
    typeof configuration === "object" && configuration !== null && !Array.isArray(configuration)
      ? Object.fromEntries(Object.entries(configuration))
      : {},
  );
}

/** Appends configurations, starting from {@link NEW_LAUNCH_JSON} when the file doesn't exist. */
export function addLaunchConfigurations(
  contents: string | null,
  configurations: ReadonlyArray<Readonly<Record<string, unknown>>>,
): string | null {
  let text = contents === null || contents.trim().length === 0 ? NEW_LAUNCH_JSON : contents;
  const root = parseLaunchJsonObject(text);
  if (root === null) return null;
  if (!Array.isArray(root.configurations)) text = edit(text, ["configurations"], []);
  for (const configuration of configurations) {
    text = edit(text, ["configurations", -1], configuration, true);
  }
  return text;
}

/** Sets one field of the configuration at `index`; `undefined` removes the field. */
export function setLaunchConfigurationField(
  contents: string,
  index: number,
  path: JsonPath,
  value: unknown,
): string | null {
  if (parseLaunchJsonObject(contents) === null) return null;
  return edit(contents, ["configurations", index, ...path], value);
}

export function removeLaunchConfiguration(contents: string, index: number): string | null {
  if (parseLaunchJsonObject(contents) === null) return null;
  return edit(contents, ["configurations", index], undefined);
}
