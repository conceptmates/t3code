import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vite-plus/test";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronPowerMonitor from "../electron/ElectronPowerMonitor.ts";
import {
  ForkUpdates,
  appBundlePath,
  forkUpdateTargetVersion,
  layer as forkUpdatesLayer,
  parseForkPipelineLine,
} from "./ForkUpdates.ts";

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

const UPSTREAM_RELEASES = [
  { tag_name: "v0.1.3-nightly.20261026.3711", draft: true },
  { tag_name: "v0.1.3-nightly.20261026.3710", body: "Newest nightly" },
  { tag_name: "v0.1.3", body: null },
  { tag_name: "v0.1.3-nightly.20261025.3655", body: "Already in this build" },
];

const layerGitHub = HttpClient.make((request) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      // Like api.github.com, which refuses requests that carry no User-Agent.
      request.headers["user-agent"] === undefined
        ? new Response(null, { status: 403 })
        : Response.json(UPSTREAM_RELEASES),
    ),
  ),
).pipe((client) => Layer.succeed(HttpClient.HttpClient, client));

const layerPowerMonitor = Layer.succeed(
  ElectronPowerMonitor.ElectronPowerMonitor,
  ElectronPowerMonitor.ElectronPowerMonitor.of({
    isOnBatteryPower: Effect.succeed(false),
    getSystemIdleTime: Effect.succeed(0),
    getSystemIdleState: () => Effect.succeed("active"),
    getCurrentThermalState: Effect.succeed("nominal"),
    onSimpleEvent: () => Effect.void,
    onThermalStateChange: () => Effect.void,
    onSpeedLimitChange: () => Effect.void,
  }),
);

describe("fork update check", () => {
  effectIt.effect("offers a build of the newest upstream nightly from GitHub", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-fork-updates-test-",
      });
      const layerEnvironment = DesktopEnvironment.layer({
        dirname: "/repo/apps/desktop/dist-electron",
        homeDirectory,
        platform: "darwin",
        processArch: "arm64",
        appVersion: "0.1.3-nightly.20261025.3656",
        appPath: "/repo",
        isPackaged: false,
        resourcesPath: "/repo/resources",
        runningUnderArm64Translation: false,
      }).pipe(Layer.provide(DesktopConfig.layerTest({ T3CODE_HOME: homeDirectory })));
      const { baseDir } = yield* DesktopEnvironment.DesktopEnvironment.pipe(
        Effect.provide(layerEnvironment),
      );
      yield* fileSystem.makeDirectory(`${baseDir}/fork-update`, { recursive: true });
      yield* fileSystem.writeFileString(
        `${baseDir}/fork-update/config.json`,
        JSON.stringify({ sourceDir: "/fork" }),
      );
      yield* TestClock.setTime(Date.parse("2026-10-26T09:00:00Z"));

      const engine = yield* ForkUpdates.pipe(
        Effect.provide(
          forkUpdatesLayer.pipe(
            Layer.provide(Layer.mergeAll(layerEnvironment, layerGitHub, layerPowerMonitor)),
          ),
        ),
      );
      assert.isTrue(Option.isSome(engine));
      if (Option.isNone(engine)) return;
      const offered: Array<unknown> = [];
      yield* engine.value.updater.on("update-available", (info: unknown) => offered.push(info));

      yield* engine.value.updater.checkForUpdates;

      assert.deepEqual(offered, [
        {
          version: "0.1.3-nightly.20261026.3711",
          releaseNotes: [{ version: "0.1.3-nightly.20261026.3710", note: "Newest nightly" }],
        },
      ]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
