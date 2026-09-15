import { describe, expect, it } from "@effect/vitest";

import { substituteLaunchVariables, type LaunchVariableContext } from "./launchVariables.ts";

const context: LaunchVariableContext = {
  workspaceFolder: "/work/app",
  userHome: "/home/dev",
  pathSeparator: "/",
  resolvePath: (base, target) => `${base}/${target}`,
  env: { API_URL: "http://localhost:3000" },
  inputValues: {},
};

describe("substituteLaunchVariables", () => {
  it("resolves workspace, home, environment and separator variables", () => {
    const result = substituteLaunchVariables(
      [
        "${workspaceFolder}/src",
        "${workspaceFolderBasename}",
        "${userHome}${/}.cache",
        "${env:API_URL}",
        "${pathSeparator}",
        "${workspaceFolder:App}/.build/debug/App",
      ],
      context,
    );

    expect(result).toEqual({
      value: [
        "/work/app/src",
        "app",
        "/home/dev/.cache",
        "http://localhost:3000",
        "/",
        "/work/app/.build/debug/App",
      ],
      unsupported: [],
      missingInputs: [],
    });
  });

  it("treats unset environment variables as empty", () => {
    expect(substituteLaunchVariables("${env:MISSING}suffix", context).value).toBe("suffix");
  });

  it("substitutes inside nested objects and arrays and leaves other values alone", () => {
    const result = substituteLaunchVariables(
      {
        env: { ROOT: "${workspaceFolder}" },
        args: ["--root", "${cwd}"],
        port: 3000,
        enabled: true,
        nothing: null,
      },
      context,
    );

    expect(result.value).toEqual({
      env: { ROOT: "/work/app" },
      args: ["--root", "/work/app"],
      port: 3000,
      enabled: true,
      nothing: null,
    });
  });

  it("reports inputs without values and fills in the ones that have values", () => {
    expect(substituteLaunchVariables("--port=${input:port}", context)).toEqual({
      value: "--port=${input:port}",
      unsupported: [],
      missingInputs: ["port"],
    });

    const provided = substituteLaunchVariables("--port=${input:port}", {
      ...context,
      inputValues: { port: "4000" },
    });
    expect(provided.value).toBe("--port=4000");
    expect(provided.missingInputs).toEqual([]);
  });

  it("reports editor-bound variables once and leaves them in place", () => {
    const result = substituteLaunchVariables(
      ["${file}", "${command:python.interpreterPath}", "${file}"],
      context,
    );

    expect(result.unsupported).toEqual(["file", "command:python.interpreterPath"]);
    expect(result.value).toEqual(["${file}", "${command:python.interpreterPath}", "${file}"]);
  });
});
