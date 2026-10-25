import { describe, expect, it } from "vite-plus/test";

import { appBundlePath, forkUpdateTargetVersion, parseForkPipelineLine } from "./ForkUpdates.ts";

describe("forkUpdateTargetVersion", () => {
  it("builds one run above a newer upstream nightly, dated today", () => {
    expect(
      forkUpdateTargetVersion(
        "0.1.1-nightly.20261018.3304",
        "0.1.3-nightly.20261025.3655",
        "20261026",
      ),
    ).toBe("0.1.3-nightly.20261026.3656");
  });

  it("offers nothing once the fork build already sits above that upstream nightly", () => {
    expect(
      forkUpdateTargetVersion(
        "0.1.3-nightly.20261025.3656",
        "0.1.3-nightly.20261025.3655",
        "20261026",
      ),
    ).toBeNull();
  });

  it("rebuilds when upstream catches up to the fork build's run number", () => {
    // The fork build took 3656 for itself; upstream's own 3656 has newer commits.
    expect(
      forkUpdateTargetVersion(
        "0.1.3-nightly.20261025.3656",
        "0.1.3-nightly.20261026.3656",
        "20261026",
      ),
    ).toBe("0.1.3-nightly.20261026.3657");
  });

  it("updates a non-nightly build and ignores non-nightly upstream tags", () => {
    expect(forkUpdateTargetVersion("0.1.0", "0.1.3-nightly.20261025.3655", "20261026")).toBe(
      "0.1.3-nightly.20261026.3656",
    );
    expect(forkUpdateTargetVersion("0.1.0", "0.1.3", "20261026")).toBeNull();
  });
});

describe("parseForkPipelineLine", () => {
  it("reads the pipeline's protocol lines and ignores everything else", () => {
    expect(parseForkPipelineLine("::progress 42 Installing dependencies")).toEqual({
      type: "progress",
      percent: 42,
      stage: "Installing dependencies",
    });
    expect(parseForkPipelineLine("::error typecheck fails after the merge")).toEqual({
      type: "error",
      message: "typecheck fails after the merge",
    });
    expect(parseForkPipelineLine("::done /tmp/T3 Code/T3-Code-1-x64.zip")).toEqual({
      type: "done",
      zipPath: "/tmp/T3 Code/T3-Code-1-x64.zip",
    });
    expect(parseForkPipelineLine("== Merging upstream")).toBeNull();
  });
});

describe("appBundlePath", () => {
  it("finds the .app bundle from the main executable", () => {
    expect(
      appBundlePath("/Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)"),
    ).toBe("/Applications/T3 Code (Nightly).app");
    expect(appBundlePath("/usr/local/bin/node")).toBeNull();
  });
});
