// @effect-diagnostics nodeBuiltinImport:off -- the fork build pipeline and install helper are child processes this module owns.
// Fork-only: upstream builds lack the fork's features and Squirrel.Mac refuses unsigned apps, so
// this stands in for electron-updater and builds each upstream nightly locally instead
// (scripts/fork-update.sh). Only `<T3 home>/fork-update/config.json` turns it on.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";

import { cliReleaseIndexPageUrl } from "@t3tools/shared/cliRelease";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronPowerMonitor from "../electron/ElectronPowerMonitor.ts";
import * as ElectronUpdater from "../electron/ElectronUpdater.ts";

const NIGHTLY_VERSION = /^(\d+\.\d+\.\d+)-nightly\.(\d{8})\.(\d+)$/;
const DEFAULT_MIN_INTERVAL_DAYS = 10;
/** Agent runs and keyboard/mouse input must both stay quiet this long before an automatic restart. */
export const FORK_INSTALL_IDLE_SECONDS = 600;

const ForkUpdateConfig = Schema.fromJsonString(
  Schema.Struct({
    /** Worktree of the fork that the pipeline resets, merges and builds in. */
    sourceDir: Schema.String,
    /** Automatic checks only build again this many days after the last fork build. */
    minIntervalDays: Schema.optional(Schema.Number),
  }),
);

const BuiltUpdate = Schema.fromJsonString(
  Schema.Struct({ version: Schema.String, upstreamVersion: Schema.String, zipPath: Schema.String }),
);
const decodeForkUpdateConfig = Schema.decodeUnknownEffect(ForkUpdateConfig);
const decodeBuiltUpdate = Schema.decodeUnknownEffect(BuiltUpdate);
const encodeBuiltUpdate = Schema.encodeEffect(BuiltUpdate);

const GitHubReleases = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.optional(Schema.Boolean),
    body: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);

/**
 * The version a fork build of upstream nightly `upstream` gets: one run above it, so it
 * sorts after the upstream build it contains. Null when `current` already contains it.
 */
export function forkUpdateTargetVersion(
  current: string,
  upstream: string,
  today: string,
): string | null {
  const upstreamMatch = NIGHTLY_VERSION.exec(upstream);
  if (!upstreamMatch) return null;
  const upstreamRun = Number(upstreamMatch[3]);
  const currentMatch = NIGHTLY_VERSION.exec(current);
  if (currentMatch && Number(currentMatch[3]) > upstreamRun) return null;
  return `${upstreamMatch[1]}-nightly.${today}.${upstreamRun + 1}`;
}

function nightlyRun(version: string): number | null {
  const match = NIGHTLY_VERSION.exec(version);
  return match ? Number(match[3]) : null;
}

export type ForkPipelineLine =
  | { readonly type: "progress"; readonly percent: number; readonly stage: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done"; readonly zipPath: string };

export function parseForkPipelineLine(line: string): ForkPipelineLine | null {
  const progress = /^::progress (\d{1,3}) (.*)$/.exec(line);
  if (progress) {
    return { type: "progress", percent: Math.min(100, Number(progress[1])), stage: progress[2]! };
  }
  if (line.startsWith("::error ")) return { type: "error", message: line.slice(8) };
  if (line.startsWith("::done ")) return { type: "done", zipPath: line.slice(7) };
  return null;
}

/** Bundle directory of the running app, from its executable inside `X.app/Contents/MacOS/`. */
export function appBundlePath(executablePath: string): string | null {
  const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(executablePath);
  return match ? match[1]! : null;
}

// Waits for the app to exit, swaps the bundle (restoring the old one if the copy fails), and
// reopens it. `open` straight after a quit can fail with -609 while LaunchServices catches up.
const INSTALL_HELPER = `
pid="$1"; zip="$2"; app="$3"; backups="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.5; done
unpacked="$(mktemp -d)"
if ditto -x -k "$zip" "$unpacked"; then
  new_app="$(find "$unpacked" -maxdepth 1 -name '*.app' | head -1)"
  backup="$backups/$(basename "$app" .app) $(date +%Y%m%d-%H%M%S).app"
  mkdir -p "$backups"
  if [ -n "$new_app" ] && mv "$app" "$backup"; then
    ditto "$new_app" "$app" || { rm -rf "$app"; mv "$backup" "$app"; }
  fi
  ls -1dt "$backups"/*.app 2>/dev/null | tail -n +3 | while read -r old; do rm -rf "$old"; done
fi
rm -rf "$unpacked"
for _ in 1 2 3 4 5; do open "$app" && break; sleep 2; done
`;

export class ForkUpdateError extends Schema.TaggedError<ForkUpdateError>()("ForkUpdateError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export interface ForkUpdateEngine {
  readonly updater: ElectronUpdater.ElectronUpdater["Service"];
  readonly automaticCheckDue: Effect.Effect<boolean>;
  /** No live agent run, and no keyboard or mouse input for {@link FORK_INSTALL_IDLE_SECONDS}. */
  readonly idleForInstall: Effect.Effect<boolean>;
}

export class ForkUpdates extends Context.Service<ForkUpdates, Option.Option<ForkUpdateEngine>>()(
  "@t3tools/desktop/updates/ForkUpdates",
) {}

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("desktop-fork-updater");

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const httpClient = yield* HttpClient.HttpClient;
  const powerMonitor = yield* ElectronPowerMonitor.ElectronPowerMonitor;
  const { path } = environment;

  const forkDir = path.join(environment.baseDir, "fork-update");
  const config = yield* fileSystem
    .readFileString(path.join(forkDir, "config.json"))
    .pipe(Effect.flatMap(decodeForkUpdateConfig), Effect.option);
  if (Option.isNone(config) || environment.platform !== "darwin") {
    return Option.none<ForkUpdateEngine>();
  }
  const { sourceDir, minIntervalDays = DEFAULT_MIN_INTERVAL_DAYS } = config.value;
  const builtPath = path.join(forkDir, "built.json");
  const lastBuildPath = path.join(forkDir, "last-build");
  // Read-only: this is the live database of the running app.
  const databasePath = path.join(environment.stateDir, "statev2.sqlite");

  const emitter = new NodeEvents.EventEmitter();
  const targetRef = yield* Ref.make<Option.Option<{ version: string; upstreamVersion: string }>>(
    Option.none(),
  );

  const readBuilt = fileSystem
    .readFileString(builtPath)
    .pipe(Effect.flatMap(decodeBuiltUpdate), Effect.option);

  const today = DateTime.now.pipe(
    Effect.map((now) => DateTime.formatIso(now).slice(0, 10).replaceAll("-", "")),
  );

  const checkForUpdates = Effect.gen(function* () {
    emitter.emit("checking-for-update");
    const releases = yield* httpClient
      .execute(
        HttpClientRequest.get(cliReleaseIndexPageUrl(1)).pipe(
          HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
          // GitHub's API answers 403 without a User-Agent, and undici sends none.
          HttpClientRequest.setHeader("User-Agent", "t3code-desktop"),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubReleases)),
      );
    const nightlies = releases.flatMap((release) => {
      const version = release.tag_name.replace(/^v/, "");
      const run = nightlyRun(version);
      return release.draft || run === null ? [] : [{ version, run, note: release.body ?? "" }];
    });
    const newest = nightlies.reduce<(typeof nightlies)[number] | null>(
      (best, release) => (best === null || release.run > best.run ? release : best),
      null,
    );
    if (newest === null) {
      emitter.emit("update-not-available");
      return;
    }

    // A build already made for this upstream nightly keeps its version across days and restarts.
    const built = yield* readBuilt;
    const builtExists = Option.isSome(built)
      ? yield* fileSystem.exists(built.value.zipPath).pipe(Effect.orElseSucceed(() => false))
      : false;
    const target =
      Option.isSome(built) &&
      builtExists &&
      built.value.upstreamVersion === newest.version &&
      built.value.version !== environment.appVersion
        ? built.value.version
        : forkUpdateTargetVersion(environment.appVersion, newest.version, yield* today);
    if (target === null) {
      emitter.emit("update-not-available");
      return;
    }

    yield* Ref.set(targetRef, Option.some({ version: target, upstreamVersion: newest.version }));
    const currentRun = nightlyRun(environment.appVersion) ?? 0;
    const releaseNotes = nightlies
      .filter((release) => release.run >= currentRun)
      .map((release) => ({ version: release.version, note: release.note }));
    yield* logInfo("upstream nightly available", { upstream: newest.version, target });
    emitter.emit("update-available", { version: target, releaseNotes });
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ElectronUpdater.ElectronUpdaterCheckForUpdatesError({ channel: "fork", cause }),
    ),
  );

  const runPipeline = (version: string, logFile: string) =>
    Effect.callback<string, ForkUpdateError>((resume) => {
      const outDir = path.join(forkDir, "builds");
      const child = NodeChildProcess.spawn(
        "/bin/bash",
        [
          path.join(sourceDir, "scripts/fork-update.sh"),
          version,
          environment.runtimeInfo.appArch,
          outDir,
          logFile,
        ],
        { cwd: sourceDir, stdio: ["ignore", "pipe", "pipe"] },
      );
      let zipPath: string | null = null;
      let errorMessage: string | null = null;
      let buffered = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const parsed = parseForkPipelineLine(line);
          if (parsed?.type === "progress") {
            emitter.emit("download-progress", { percent: parsed.percent });
          } else if (parsed?.type === "error") {
            errorMessage = parsed.message;
          } else if (parsed?.type === "done") {
            zipPath = parsed.zipPath;
          }
        }
      });
      child.on("error", (error) =>
        resume(
          Effect.fail(
            new ForkUpdateError({ detail: `could not start the fork pipeline: ${error.message}` }),
          ),
        ),
      );
      child.on("close", (code) => {
        if (code === 0 && zipPath !== null) {
          resume(Effect.succeed(zipPath));
        } else {
          resume(
            Effect.fail(
              new ForkUpdateError({
                detail: `${errorMessage ?? `fork update exited with ${code}`}. Log: ${logFile}`,
              }),
            ),
          );
        }
      });
      return Effect.sync(() => child.kill());
    });

  const downloadUpdate = Effect.gen(function* () {
    const target = yield* Ref.get(targetRef);
    if (Option.isNone(target)) {
      return yield* new ForkUpdateError({ detail: "No fork update is pending." });
    }
    const { version, upstreamVersion } = target.value;
    const built = yield* readBuilt;
    let zipPath =
      Option.isSome(built) && built.value.version === version ? built.value.zipPath : null;
    if (zipPath === null || !(yield* fileSystem.exists(zipPath))) {
      const stamp = (yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))).replace(/\D/g, "");
      const logFile = path.join(forkDir, "logs", `${stamp.slice(0, 14)}.log`);
      yield* logInfo("building fork update", { version, upstreamVersion, logFile });
      zipPath = yield* runPipeline(version, logFile);
      yield* fileSystem.writeFileString(
        builtPath,
        yield* encodeBuiltUpdate({ version, upstreamVersion, zipPath }),
      );
      yield* fileSystem.writeFileString(lastBuildPath, String(yield* Clock.currentTimeMillis));
    }
    emitter.emit("download-progress", { percent: 100 });
    emitter.emit("update-downloaded", { version });
  }).pipe(
    Effect.mapError(
      (cause) => new ElectronUpdater.ElectronUpdaterDownloadUpdateError({ channel: "fork", cause }),
    ),
  );

  const quitAndInstall = Effect.fn("ForkUpdates.quitAndInstall")(
    function* (_options: { readonly isSilent: boolean; readonly isForceRunAfter: boolean }) {
      const built = yield* readBuilt;
      const app = appBundlePath(process.execPath);
      if (Option.isNone(built) || app === null) {
        return yield* new ForkUpdateError({ detail: "No built fork update to install." });
      }
      const helper = NodeChildProcess.spawn(
        "/bin/bash",
        [
          "-c",
          INSTALL_HELPER,
          "fork-install",
          String(process.pid),
          built.value.zipPath,
          app,
          path.join(forkDir, "backups"),
        ],
        { detached: true, stdio: "ignore" },
      );
      helper.unref();
      yield* logInfo("restarting into fork update", { version: built.value.version });
      Electron.app.quit();
    },
    (effect, { isSilent, isForceRunAfter }) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ElectronUpdater.ElectronUpdaterQuitAndInstallError({
              channel: "fork",
              isSilent,
              isForceRunAfter,
              cause,
            }),
        ),
      ),
  );

  const liveRuns = Effect.callback<number>((resume) => {
    NodeChildProcess.execFile(
      "/usr/bin/sqlite3",
      [
        `file:${databasePath}?mode=ro`,
        // `queued` runs are saved follow-ups with no process behind them; some sit for weeks.
        "SELECT count(*) FROM orchestration_v2_projection_runs WHERE status IN ('preparing','starting','running','waiting');",
      ],
      { timeout: 10_000 },
      (error, stdout) => {
        const count = Number(stdout.trim());
        // An unreadable database counts as busy: never restart over work we cannot see.
        resume(Effect.succeed(error || !Number.isFinite(count) ? 1 : count));
      },
    );
  });

  const updater = ElectronUpdater.ElectronUpdater.of({
    setFeedURL: Effect.fn("ForkUpdates.setFeedURL")(function () {
      return Effect.void;
    }),
    setAutoDownload: Effect.fn("ForkUpdates.setAutoDownload")(function () {
      return Effect.void;
    }),
    setAutoInstallOnAppQuit: Effect.fn("ForkUpdates.setAutoInstallOnAppQuit")(function () {
      return Effect.void;
    }),
    setChannel: Effect.fn("ForkUpdates.setChannel")(function () {
      return Effect.void;
    }),
    setAllowPrerelease: Effect.fn("ForkUpdates.setAllowPrerelease")(function () {
      return Effect.void;
    }),
    allowDowngrade: Effect.succeed(false),
    setAllowDowngrade: Effect.fn("ForkUpdates.setAllowDowngrade")(function () {
      return Effect.void;
    }),
    setFullChangelog: Effect.fn("ForkUpdates.setFullChangelog")(function () {
      return Effect.void;
    }),
    setDisableDifferentialDownload: Effect.fn("ForkUpdates.setDisableDifferentialDownload")(
      function () {
        return Effect.void;
      },
    ),
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    on: Effect.fn("ForkUpdates.on")(function (eventName, listener) {
      const untyped = listener as unknown as (...args: Array<unknown>) => void;
      return Effect.acquireRelease(
        Effect.sync(() => {
          emitter.on(eventName, untyped);
        }),
        () =>
          Effect.sync(() => {
            emitter.removeListener(eventName, untyped);
          }),
      ).pipe(Effect.asVoid);
    }),
  });

  yield* logInfo("fork updates enabled", { sourceDir, minIntervalDays });
  return Option.some<ForkUpdateEngine>({
    updater,
    automaticCheckDue: Effect.gen(function* () {
      const lastBuild = Number(yield* fileSystem.readFileString(lastBuildPath));
      return (yield* Clock.currentTimeMillis) - lastBuild >= minIntervalDays * 86_400_000;
    }).pipe(Effect.orElseSucceed(() => true)),
    idleForInstall: Effect.gen(function* () {
      if ((yield* powerMonitor.getSystemIdleTime) < FORK_INSTALL_IDLE_SECONDS) return false;
      return (yield* liveRuns) === 0;
    }).pipe(
      Effect.catchCause(() => logWarning("could not read idle state").pipe(Effect.as(false))),
    ),
  });
});

export const layer = Layer.effect(ForkUpdates, make);

export const layerDisabled = Layer.succeed(ForkUpdates, Option.none());
