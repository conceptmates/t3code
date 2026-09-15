import { describe, expect, it } from "vite-plus/test";

import {
  formatEnvFieldValue,
  formatListFieldValue,
  launchFormFields,
  parseEnvFieldValue,
  parseListFieldValue,
} from "./launchFormFields";

describe("launchFormFields", () => {
  it("shows type-specific fields before the common ones, including aliased types", () => {
    const keys = launchFormFields("pwa-node").map((field) => field.key);

    expect(keys.slice(0, 4)).toEqual(["program", "runtimeExecutable", "runtimeArgs", "args"]);
    expect(keys.slice(-4)).toEqual(["cwd", "preLaunchTask", "env", "envFile"]);
    expect(launchFormFields("dart").find((field) => field.key === "flutterMode")?.choices).toEqual([
      "debug",
      "profile",
      "release",
    ]);
  });

  it("falls back to the common fields for types without a form", () => {
    expect(launchFormFields("ruby").map((field) => field.key)).toEqual([
      "cwd",
      "preLaunchTask",
      "env",
      "envFile",
    ]);
  });
});

describe("list fields", () => {
  it("round-trips one item per line, keeping spaces inside items", () => {
    expect(formatListFieldValue(["--greeting", "hello world"])).toBe("--greeting\nhello world");
    expect(parseListFieldValue("--greeting\nhello world\n\n")).toEqual([
      "--greeting",
      "hello world",
    ]);
  });

  it("shows a string value as-is and removes the field when cleared", () => {
    expect(formatListFieldValue("--port 3000")).toBe("--port 3000");
    expect(formatListFieldValue(undefined)).toBe("");
    expect(parseListFieldValue("  \n")).toBeUndefined();
  });
});

describe("env fields", () => {
  it("round-trips KEY=VALUE lines, keeping = inside values", () => {
    expect(formatEnvFieldValue({ DEBUG: "1", URL: "a=b" })).toBe("DEBUG=1\nURL=a=b");
    expect(parseEnvFieldValue("DEBUG=1\nURL=a=b\nEMPTY\n")).toEqual({
      DEBUG: "1",
      URL: "a=b",
      EMPTY: "",
    });
    expect(parseEnvFieldValue("")).toBeUndefined();
  });
});
