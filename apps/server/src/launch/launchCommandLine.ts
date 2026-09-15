/**
 * Joins resolved launch steps into the one POSIX shell command a launch
 * terminal runs. Each step runs in a subshell so its `cd` and environment
 * don't leak into the next, and `&&` stops at the first failing step so the
 * terminal's exit code is that step's.
 *
 * @module launchCommandLine
 */
import type { LaunchRunStep } from "@t3tools/contracts";

import { quoteShellArg } from "./launchTasks.ts";

const SHELL_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stepCommand(step: LaunchRunStep): string {
  const entries = Object.entries(step.env);
  const unset = entries.flatMap(([key, value]) => (value === null ? [key] : []));
  const assignments = entries.flatMap(([key, value]) =>
    value === null ? [] : [`${key}=${quoteShellArg(value)}`],
  );
  const cd = `cd -- ${quoteShellArg(step.cwd)}`;

  if (step._tag === "shell") {
    const exports = assignments
      .filter((assignment) => SHELL_VARIABLE_NAME.test(assignment.split("=")[0] ?? ""))
      .map((assignment) => `export ${assignment}`);
    const unsets = unset.filter((key) => SHELL_VARIABLE_NAME.test(key));
    return `(${[cd, ...exports, ...(unsets.length === 0 ? [] : [`unset ${unsets.join(" ")}`]), step.commandLine].join(" && ")})`;
  }

  // `exec` makes the program the subshell itself, so Ctrl-C and exit codes reach it directly.
  const env =
    entries.length === 0
      ? []
      : ["env", ...unset.flatMap((key) => ["-u", quoteShellArg(key)]), ...assignments];
  const argv = [...env, quoteShellArg(step.command), ...step.args.map(quoteShellArg)];
  return `(${cd} && exec ${argv.join(" ")})`;
}

export function launchCommandLine(steps: ReadonlyArray<LaunchRunStep>): string {
  return steps.map(stepCommand).join(" && ");
}
