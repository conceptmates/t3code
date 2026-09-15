/**
 * Starter configurations for "Add configuration": what a project's files say
 * it can run, written in VS Code's launch.json format so the file keeps
 * working in VS Code.
 *
 * @module launchStarters
 */
import type { LaunchStarter } from "@t3tools/contracts";

import type { LaunchWorkspaceFacts } from "./launchRecipes.ts";
import { packageManager } from "./launchTasks.ts";

export interface LaunchStarterInput {
  readonly facts: LaunchWorkspaceFacts;
  readonly packageScripts: ReadonlyArray<string>;
  readonly swiftExecutableTargets: ReadonlyArray<string>;
  readonly cargoPackageName: string | null;
  readonly hasGoModule: boolean;
  /** First of main.py, app.py, manage.py found at the root. */
  readonly pythonEntry: string | null;
}

const PACKAGE_SCRIPT_STARTERS = ["dev", "start", "serve"];

const launch = (configuration: Record<string, unknown>) => ({
  request: "launch",
  ...configuration,
});

export function launchStarters(input: LaunchStarterInput): Array<LaunchStarter> {
  const starters: Array<LaunchStarter> = [];
  const { facts } = input;

  const runner = packageManager(facts);
  for (const script of PACKAGE_SCRIPT_STARTERS.filter((name) =>
    input.packageScripts.includes(name),
  )) {
    starters.push({
      label: `${runner} run ${script}`,
      description: "package.json script",
      configuration: launch({
        type: "node",
        name: `${runner} run ${script}`,
        runtimeExecutable: runner,
        runtimeArgs: ["run", script],
        cwd: "${workspaceFolder}",
      }),
    });
  }

  if (facts.isFlutterProject) {
    starters.push({
      label: "Flutter",
      description: "flutter run with hot reload",
      configuration: launch({ type: "dart", name: "Flutter", program: "lib/main.dart" }),
    });
  } else if (facts.markers.has("pubspec.yaml")) {
    starters.push({
      label: "Dart",
      description: "dart run",
      configuration: launch({ type: "dart", name: "Dart", program: "bin/main.dart" }),
    });
  }

  for (const target of input.swiftExecutableTargets) {
    starters.push({
      label: `Swift: ${target}`,
      description: "swift run",
      configuration: launch({ type: "swift", name: `Run ${target}`, target }),
    });
  }

  if (input.cargoPackageName !== null) {
    starters.push({
      label: `Rust: ${input.cargoPackageName}`,
      description: "cargo run (CodeLLDB format)",
      configuration: launch({
        type: "lldb",
        name: `Run ${input.cargoPackageName}`,
        cargo: { args: ["build", `--bin=${input.cargoPackageName}`] },
        args: [],
      }),
    });
  }

  if (input.hasGoModule) {
    starters.push({
      label: "Go",
      description: "go run",
      configuration: launch({
        type: "go",
        name: "Go: run",
        mode: "auto",
        program: "${workspaceFolder}",
      }),
    });
  }

  if (input.pythonEntry !== null) {
    starters.push({
      label: `Python: ${input.pythonEntry}`,
      description: input.pythonEntry === "manage.py" ? "Django development server" : "python",
      configuration: launch({
        type: "debugpy",
        name: `Python: ${input.pythonEntry}`,
        program: `\${workspaceFolder}/${input.pythonEntry}`,
        ...(input.pythonEntry === "manage.py" ? { args: ["runserver"] } : {}),
      }),
    });
  }

  if (facts.markers.has("build.gradle") || facts.markers.has("build.gradle.kts")) {
    starters.push({
      label: "Gradle: run",
      description: "The application plugin's run task",
      configuration: launch({ type: "java", name: "Gradle: run", mainClass: "Main" }),
    });
  } else if (facts.markers.has("pom.xml")) {
    starters.push({
      label: "Maven: exec:java",
      description: "Set mainClass to your entry point",
      configuration: launch({ type: "java", name: "Maven: run", mainClass: "com.example.Main" }),
    });
  }

  return starters;
}

const SWIFT_EXECUTABLE_TARGET = /\.executableTarget\(\s*name:\s*"([^"]+)"/g;

export function parseSwiftExecutableTargets(packageSwift: string | null): Array<string> {
  if (packageSwift === null) return [];
  return [
    ...new Set(
      [...packageSwift.matchAll(SWIFT_EXECUTABLE_TARGET)].flatMap((match) => match[1] ?? []),
    ),
  ];
}

/** The `name` under `[package]` in Cargo.toml; workspace-only manifests have none. */
export function parseCargoPackageName(cargoToml: string | null): string | null {
  if (cargoToml === null) return null;
  let inPackage = false;
  for (const line of cargoToml.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) {
      inPackage = section[1]?.trim() === "package";
      continue;
    }
    const name = inPackage ? /^\s*name\s*=\s*"([^"]+)"/.exec(line)?.[1] : undefined;
    if (name !== undefined) return name;
  }
  return null;
}
