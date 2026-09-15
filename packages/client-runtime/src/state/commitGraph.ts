import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/**
 * Source Control surface atoms: commit history, working copy, and the writes
 * that change them. Not to be confused with `./sourceControl.ts`, which is
 * about hosting providers.
 */
export function createCommitGraphEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  /** One write at a time per repository; git's index is a single lock. */
  const perRepository = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { cwd: string } }) =>
      JSON.stringify([environmentId, input.cwd]),
  };

  return {
    commits: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:commit-graph:commits",
      tag: WS_METHODS.vcsCommitGraph,
      staleTimeMs: 5_000,
      idleTtlMs: 5 * 60_000,
    }),
    commitFiles: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:commit-graph:commit-files",
      tag: WS_METHODS.vcsCommitFiles,
      // A commit's contents never change, so this only needs to survive the panel.
      staleTimeMs: 60 * 60_000,
      idleTtlMs: 5 * 60_000,
    }),
    commitPatch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:commit-graph:commit-patch",
      tag: WS_METHODS.vcsCommitPatch,
      staleTimeMs: 60 * 60_000,
      idleTtlMs: 5 * 60_000,
    }),
    workingCopy: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:commit-graph:working-copy",
      tag: WS_METHODS.vcsWorkingCopyStatus,
      staleTimeMs: 2_000,
      idleTtlMs: 5 * 60_000,
    }),
    stage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commit-graph:stage",
      tag: WS_METHODS.vcsStage,
      scheduler,
      concurrency: perRepository,
    }),
    commit: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commit-graph:commit",
      tag: WS_METHODS.vcsCommit,
      scheduler,
      concurrency: perRepository,
    }),
    suggestMessage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commit-graph:suggest-message",
      tag: WS_METHODS.vcsSuggestCommitMessage,
      scheduler,
      concurrency: perRepository,
    }),
  };
}
