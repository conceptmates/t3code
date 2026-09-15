import { describe, expect, it } from "vite-plus/test";

import {
  NEW_LAUNCH_JSON,
  addLaunchConfigurations,
  readLaunchConfigurations,
  removeLaunchConfiguration,
  setLaunchConfigurationField,
} from "./launchJsonEdits";

const EXISTING = `{
  // Team launch configurations
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "name": "Server", // the API
      "program": "\${workspaceFolder}/server.js"
    }
  ]
}
`;

describe("addLaunchConfigurations", () => {
  it("creates the file text when launch.json doesn't exist", () => {
    const text = addLaunchConfigurations(null, [{ type: "go", name: "Go: run" }]);

    expect(text).not.toBeNull();
    expect(readLaunchConfigurations(text!)).toEqual([{ type: "go", name: "Go: run" }]);
    expect(text).toContain("// See https://go.microsoft.com/fwlink/?linkid=830387");
  });

  it("appends after existing configurations and keeps comments", () => {
    const text = addLaunchConfigurations(EXISTING, [{ type: "dart", name: "Flutter" }])!;

    expect(readLaunchConfigurations(text)?.map((configuration) => configuration.name)).toEqual([
      "Server",
      "Flutter",
    ]);
    expect(text).toContain("// Team launch configurations");
    expect(text).toContain("// the API");
  });

  it("adds a configurations array when the file has none", () => {
    const text = addLaunchConfigurations(`{ "version": "0.2.0" }`, [{ name: "A" }])!;

    expect(readLaunchConfigurations(text)).toEqual([{ name: "A" }]);
  });

  it("refuses to edit text that isn't a JSON object", () => {
    expect(addLaunchConfigurations("{ broken", [{ name: "A" }])).toBeNull();
    expect(addLaunchConfigurations("[]", [{ name: "A" }])).toBeNull();
  });
});

describe("setLaunchConfigurationField", () => {
  it("sets and removes fields in place", () => {
    const withArgs = setLaunchConfigurationField(EXISTING, 0, ["args"], ["--port", "3000"])!;
    expect(readLaunchConfigurations(withArgs)?.[0]).toMatchObject({ args: ["--port", "3000"] });
    expect(withArgs).toContain("// the API");

    const withEnv = setLaunchConfigurationField(withArgs, 0, ["env", "DEBUG"], "1")!;
    expect(readLaunchConfigurations(withEnv)?.[0]).toMatchObject({ env: { DEBUG: "1" } });

    const removed = setLaunchConfigurationField(withEnv, 0, ["program"], undefined)!;
    expect(readLaunchConfigurations(removed)?.[0]).not.toHaveProperty("program");
  });
});

describe("removeLaunchConfiguration", () => {
  it("removes one configuration", () => {
    const text = addLaunchConfigurations(EXISTING, [{ name: "Second" }])!;

    expect(
      readLaunchConfigurations(removeLaunchConfiguration(text, 0)!)?.map((entry) => entry.name),
    ).toEqual(["Second"]);
  });
});

describe("readLaunchConfigurations", () => {
  it("reads the new-file template as empty and rejects broken files", () => {
    expect(readLaunchConfigurations(NEW_LAUNCH_JSON)).toEqual([]);
    expect(readLaunchConfigurations("{ nope")).toBeNull();
  });
});
