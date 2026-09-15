import { describe, expect, it } from "@effect/vitest";
import {
  launchTerminalId,
  type LaunchConfigEntry,
  type LaunchRunStep,
  type TerminalEvent,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";

import * as TerminalManager from "../terminal/Manager.ts";
import * as LaunchConfigs from "./LaunchConfigs.ts";
import * as LaunchSessions from "./LaunchSessions.ts";

const THREAD_ID = "thread-1";

const step = (command: string): LaunchRunStep => ({
  _tag: "exec",
  label: command,
  command,
  args: [],
  cwd: "/work/app",
  env: {},
});

const configuration = (name: string, status: LaunchConfigEntry["status"]): LaunchConfigEntry => ({
  name,
  kind: "configuration",
  type: "node",
  request: "launch",
  configurations: [],
  hotReload: false,
  warnings: [],
  status,
});

const compound = (
  name: string,
  members: ReadonlyArray<string>,
  preLaunch: ReadonlyArray<LaunchRunStep> = [],
): LaunchConfigEntry => ({
  name,
  kind: "compound",
  type: null,
  request: null,
  configurations: members,
  hotReload: false,
  warnings: [],
  status: { _tag: "runnable", steps: preLaunch },
});

const exited = (terminalId: string, exitCode: number): TerminalEvent => ({
  type: "exited",
  threadId: THREAD_ID,
  terminalId,
  exitCode,
  exitSignal: null,
});

/** Fake terminal manager that reports every call on a queue, so tests wait on calls instead of timing. */
const makeHarness = Effect.fn("makeHarness")(function* (
  entries: ReadonlyArray<LaunchConfigEntry>,
  platform: NodeJS.Platform = "linux",
) {
  const started = yield* Queue.unbounded<{
    readonly terminalId: string;
    readonly command?: string;
  }>();
  const written = yield* Queue.unbounded<{ readonly terminalId: string; readonly data: string }>();
  const closed = yield* Queue.unbounded<string>();
  const unsubscribed = yield* Queue.unbounded<string>();
  const listeners = new Set<(event: TerminalEvent) => Effect.Effect<void>>();

  const layer = LaunchSessions.layer.pipe(
    Layer.provide(
      Layer.mock(LaunchConfigs.LaunchConfigs)({
        list: () =>
          Effect.succeed({ launchFile: { _tag: "valid" }, entries, inputs: [], warnings: [] }),
      }),
    ),
    Layer.provide(
      Layer.mock(TerminalManager.TerminalManager)({
        restart: (input) =>
          Queue.offer(started, {
            terminalId: input.terminalId,
            ...(input.command === undefined ? {} : { command: input.command }),
          }).pipe(
            Effect.as({
              threadId: input.threadId,
              terminalId: input.terminalId,
              cwd: input.cwd,
              worktreePath: null,
              status: "running" as const,
              pid: 1,
              history: "",
              exitCode: null,
              exitSignal: null,
              label: "",
              updatedAt: "",
            }),
          ),
        write: (input) =>
          Queue.offer(written, { terminalId: input.terminalId, data: input.data }).pipe(
            Effect.asVoid,
          ),
        close: (input) => Queue.offer(closed, input.terminalId ?? "").pipe(Effect.asVoid),
        subscribe: (listener) =>
          Effect.sync(() => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
              Queue.offerUnsafe(unsubscribed, "unsubscribed");
            };
          }),
      }),
    ),
    Layer.provide(Layer.succeed(HostProcessPlatform, platform)),
  );

  const emit = (event: TerminalEvent) =>
    Effect.forEach([...listeners], (listener) => listener(event), { discard: true });

  return { layer, started, written, closed, unsubscribed, emit };
});

describe("LaunchSessions", () => {
  describe("run", () => {
    it.effect("runs a configuration in its own terminal", () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([
          configuration("Server", { _tag: "runnable", steps: [step("node")] }),
        ]);

        yield* Effect.gen(function* () {
          const launchSessions = yield* LaunchSessions.LaunchSessions;
          const result = yield* launchSessions.run({
            threadId: THREAD_ID,
            cwd: "/work/app",
            name: "Server",
          });

          expect(result.sessions).toEqual([
            { name: "Server", terminalId: launchTerminalId("Server"), role: "configuration" },
          ]);
          expect(yield* Queue.take(harness.started)).toEqual({
            terminalId: launchTerminalId("Server"),
            command: "(cd -- /work/app && exec node)",
          });
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("explains entries it can't run", () =>
      Effect.gen(function* () {
        const entries = [
          configuration("API", { _tag: "missing-toolchain", binary: "go" }),
          configuration("Worker", { _tag: "needs-inputs", inputIds: ["queue"] }),
        ];
        const run = (name: string, platform?: NodeJS.Platform) =>
          Effect.gen(function* () {
            const harness = yield* makeHarness(entries, platform);
            return yield* Effect.gen(function* () {
              const launchSessions = yield* LaunchSessions.LaunchSessions;
              return yield* launchSessions
                .run({ threadId: THREAD_ID, cwd: "/work/app", name })
                .pipe(Effect.flip);
            }).pipe(Effect.provide(harness.layer));
          });

        expect((yield* run("API")).message).toBe("go isn't installed on this machine.");
        expect((yield* run("Worker")).message).toBe("Provide values for queue first.");
        expect((yield* run("Missing")).message).toBe(
          `There's no launch configuration named "Missing".`,
        );
        expect((yield* run("API", "win32")).message).toBe(
          "Running launch configurations on Windows isn't supported yet.",
        );
      }),
    );

    it.effect("starts compound members right away when there's no preLaunchTask", () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([
          configuration("Web", { _tag: "runnable", steps: [step("vite")] }),
          configuration("API", { _tag: "runnable", steps: [step("go")] }),
          compound("Full stack", ["Web", "API"]),
        ]);

        yield* Effect.gen(function* () {
          const launchSessions = yield* LaunchSessions.LaunchSessions;
          const result = yield* launchSessions.run({
            threadId: THREAD_ID,
            cwd: "/work/app",
            name: "Full stack",
          });

          expect(result.sessions.map((session) => session.name)).toEqual(["Web", "API"]);
          expect((yield* Queue.take(harness.started)).terminalId).toBe(launchTerminalId("Web"));
          expect((yield* Queue.take(harness.started)).terminalId).toBe(launchTerminalId("API"));
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("starts compound members only after the preLaunchTask succeeds", () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([
          configuration("Web", { _tag: "runnable", steps: [step("vite")] }),
          compound("Full stack", ["Web"], [step("npm")]),
        ]);
        const preLaunchId = launchTerminalId("Full stack");

        yield* Effect.gen(function* () {
          const launchSessions = yield* LaunchSessions.LaunchSessions;
          const result = yield* launchSessions.run({
            threadId: THREAD_ID,
            cwd: "/work/app",
            name: "Full stack",
          });

          expect(result.sessions).toEqual([
            { name: "Full stack", terminalId: preLaunchId, role: "preLaunch" },
            { name: "Web", terminalId: launchTerminalId("Web"), role: "configuration" },
          ]);
          expect((yield* Queue.take(harness.started)).terminalId).toBe(preLaunchId);
          expect(yield* Queue.size(harness.started)).toBe(0);

          yield* harness.emit(exited(preLaunchId, 0));
          expect((yield* Queue.take(harness.started)).terminalId).toBe(launchTerminalId("Web"));
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("doesn't start compound members when the preLaunchTask fails", () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([
          configuration("Web", { _tag: "runnable", steps: [step("vite")] }),
          compound("Full stack", ["Web"], [step("npm")]),
        ]);
        const preLaunchId = launchTerminalId("Full stack");

        yield* Effect.gen(function* () {
          const launchSessions = yield* LaunchSessions.LaunchSessions;
          yield* launchSessions.run({ threadId: THREAD_ID, cwd: "/work/app", name: "Full stack" });
          yield* Queue.take(harness.started);

          yield* harness.emit(exited(preLaunchId, 1));
          yield* Queue.take(harness.unsubscribed);
          expect(yield* Queue.size(harness.started)).toBe(0);
        }).pipe(Effect.provide(harness.layer));
      }),
    );
  });

  describe("stop", () => {
    it.effect("sends Ctrl-C and leaves a session that exits in time", () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([]);

        yield* Effect.gen(function* () {
          const launchSessions = yield* LaunchSessions.LaunchSessions;
          yield* launchSessions.stop({ threadId: THREAD_ID, terminalId: "launch-app" });

          expect(yield* Queue.take(harness.written)).toEqual({
            terminalId: "launch-app",
            data: "\u0003",
          });
          yield* harness.emit(exited("launch-app", 130));
          yield* Queue.take(harness.unsubscribed);
          expect(yield* Queue.size(harness.closed)).toBe(0);
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("closes a session that ignores Ctrl-C", () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([]);

        yield* Effect.gen(function* () {
          const launchSessions = yield* LaunchSessions.LaunchSessions;
          yield* launchSessions.stop({ threadId: THREAD_ID, terminalId: "launch-app" });
          yield* Queue.take(harness.written);

          yield* TestClock.adjust(LaunchSessions.LAUNCH_STOP_GRACE);
          expect(yield* Queue.take(harness.closed)).toBe("launch-app");
        }).pipe(Effect.provide(harness.layer));
      }),
    );
  });
});
