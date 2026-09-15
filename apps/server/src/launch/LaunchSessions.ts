/**
 * LaunchSessions - runs launch configurations as terminal sessions and stops
 * them.
 *
 * Each configuration runs in the terminal `launchTerminalId(name)` whose
 * process is the resolved command, so the terminal's exit code is the run's.
 * Running a configuration again restarts that terminal.
 *
 * @module LaunchSessions
 */
import {
  LaunchRunError,
  LaunchStopError,
  launchTerminalId,
  type LaunchConfigStatus,
  type LaunchRunInput,
  type LaunchRunResult,
  type LaunchRunStep,
  type LaunchStopInput,
  type TerminalError,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import * as TerminalManager from "../terminal/Manager.ts";
import { launchCommandLine } from "./launchCommandLine.ts";
import * as LaunchConfigs from "./LaunchConfigs.ts";

const LAUNCH_TERMINAL_COLS = 120;
const LAUNCH_TERMINAL_ROWS = 30;
const CTRL_C = "\u0003";

/** How long a stopped session gets to exit after Ctrl-C before its terminal is closed. */
export const LAUNCH_STOP_GRACE = Duration.seconds(5);

/** Service tag for running and stopping launch configurations. */
export class LaunchSessions extends Context.Service<
  LaunchSessions,
  {
    readonly run: (input: LaunchRunInput) => Effect.Effect<LaunchRunResult, LaunchRunError>;
    readonly stop: (input: LaunchStopInput) => Effect.Effect<void, LaunchStopError>;
  }
>()("t3/launch/LaunchSessions") {}

function unrunnableReason(status: Exclude<LaunchConfigStatus, { readonly _tag: "runnable" }>) {
  switch (status._tag) {
    case "unsupported":
      return status.reason;
    case "missing-toolchain":
      return `${status.binary} isn't installed on this machine.`;
    case "needs-inputs":
      return `Provide values for ${status.inputIds.join(", ")} first.`;
  }
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const launchConfigs = yield* LaunchConfigs.LaunchConfigs;
  const terminalManager = yield* TerminalManager.TerminalManager;
  const platform = yield* HostProcessPlatform;
  const scope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));

  /** Subscribe before starting or signalling the terminal so its exit can't be missed. */
  const watchExit = Effect.fn("LaunchSessions.watchExit")(function* (
    threadId: string,
    terminalId: string,
  ) {
    const exited = yield* Deferred.make<number | null>();
    const unsubscribe = yield* terminalManager.subscribe((event) => {
      if (event.threadId !== threadId || event.terminalId !== terminalId) return Effect.void;
      if (event.type === "exited") {
        return Deferred.succeed(exited, event.exitCode).pipe(Effect.asVoid);
      }
      // A closed terminal was stopped by the user and has no exit code.
      if (event.type === "closed") return Deferred.succeed(exited, null).pipe(Effect.asVoid);
      return Effect.void;
    });
    return { exitCode: Deferred.await(exited), unsubscribe: Effect.sync(unsubscribe) };
  });

  const startSteps = (
    input: LaunchRunInput,
    terminalId: string,
    steps: ReadonlyArray<LaunchRunStep>,
  ) =>
    terminalManager.restart({
      threadId: input.threadId,
      terminalId,
      cwd: input.cwd,
      ...(input.worktreePath === undefined ? {} : { worktreePath: input.worktreePath }),
      cols: LAUNCH_TERMINAL_COLS,
      rows: LAUNCH_TERMINAL_ROWS,
      command: launchCommandLine(steps),
    });

  const run = Effect.fn("LaunchSessions.run")(function* (
    input: LaunchRunInput,
  ): Effect.fn.Return<LaunchRunResult, LaunchRunError> {
    const fail = (message: string, cause?: unknown) =>
      new LaunchRunError({
        name: input.name,
        message,
        ...(cause === undefined ? {} : { cause }),
      });
    const failToStart = (cause: TerminalError) => fail(cause.message, cause);
    if (platform === "win32") {
      return yield* fail("Running launch configurations on Windows isn't supported yet.");
    }

    const listed = yield* launchConfigs
      .list({
        cwd: input.cwd,
        ...(input.inputValues === undefined ? {} : { inputValues: input.inputValues }),
      })
      .pipe(Effect.mapError((cause) => fail(cause.message, cause)));
    const entry = listed.entries.find((candidate) => candidate.name === input.name);
    if (entry === undefined) {
      return yield* fail(`There's no launch configuration named "${input.name}".`);
    }
    if (entry.status._tag !== "runnable") return yield* fail(unrunnableReason(entry.status));

    if (entry.kind === "configuration") {
      const terminalId = launchTerminalId(entry.name);
      yield* startSteps(input, terminalId, entry.status.steps).pipe(Effect.mapError(failToStart));
      return { sessions: [{ name: entry.name, terminalId, role: "configuration" }] };
    }

    // A runnable compound only has runnable members.
    const members = entry.configurations.flatMap((name) => {
      const member = listed.entries.find(
        (candidate) => candidate.kind === "configuration" && candidate.name === name,
      );
      return member?.status._tag === "runnable" ? [{ name, steps: member.status.steps }] : [];
    });
    const startMembers = Effect.forEach(
      members,
      (member) => startSteps(input, launchTerminalId(member.name), member.steps),
      { discard: true },
    );
    const memberSessions = members.map((member) => ({
      name: member.name,
      terminalId: launchTerminalId(member.name),
      role: "configuration" as const,
    }));

    if (entry.status.steps.length === 0) {
      yield* startMembers.pipe(Effect.mapError(failToStart));
      return { sessions: memberSessions };
    }

    const preLaunchTerminalId = launchTerminalId(entry.name);
    const preLaunch = yield* watchExit(input.threadId, preLaunchTerminalId);
    yield* startSteps(input, preLaunchTerminalId, entry.status.steps).pipe(
      Effect.onError(() => preLaunch.unsubscribe),
      Effect.mapError(failToStart),
    );
    // Like VS Code, the compound's configurations start once its preLaunchTask succeeds.
    yield* preLaunch.exitCode.pipe(
      Effect.flatMap((exitCode) => (exitCode === 0 ? startMembers : Effect.void)),
      Effect.catch((cause) =>
        Effect.logWarning("failed to start compound configurations", {
          compound: entry.name,
          cause,
        }),
      ),
      Effect.ensuring(preLaunch.unsubscribe),
      Effect.forkIn(scope, { startImmediately: true }),
    );
    return {
      sessions: [
        { name: entry.name, terminalId: preLaunchTerminalId, role: "preLaunch" },
        ...memberSessions,
      ],
    };
  });

  const stop = Effect.fn("LaunchSessions.stop")(function* (
    input: LaunchStopInput,
  ): Effect.fn.Return<void, LaunchStopError> {
    const session = yield* watchExit(input.threadId, input.terminalId);
    yield* terminalManager
      .write({ threadId: input.threadId, terminalId: input.terminalId, data: CTRL_C })
      .pipe(
        Effect.onError(() => session.unsubscribe),
        Effect.mapError(
          (cause) =>
            new LaunchStopError({ terminalId: input.terminalId, message: cause.message, cause }),
        ),
      );
    yield* session.exitCode.pipe(
      Effect.timeoutOption(LAUNCH_STOP_GRACE),
      Effect.flatMap((exited) =>
        Option.isSome(exited)
          ? Effect.void
          : terminalManager.close({ threadId: input.threadId, terminalId: input.terminalId }),
      ),
      Effect.catch((cause) =>
        Effect.logWarning("failed to close a launch session that ignored Ctrl-C", {
          terminalId: input.terminalId,
          cause,
        }),
      ),
      Effect.ensuring(session.unsubscribe),
      Effect.forkIn(scope, { startImmediately: true }),
    );
  });

  return LaunchSessions.of({ run, stop });
});

export const layer = Layer.effect(LaunchSessions, make);
