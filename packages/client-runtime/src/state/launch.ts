import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/** Launch configuration atoms: the resolved `.vscode/launch.json` and its run/stop commands. */
export function createLaunchEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  return {
    configs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:launch:configs",
      tag: WS_METHODS.launchListConfigs,
      staleTimeMs: 10_000,
      idleTtlMs: 5 * 60_000,
    }),
    starters: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:launch:starters",
      tag: WS_METHODS.launchStarters,
      staleTimeMs: 30_000,
      idleTtlMs: 5 * 60_000,
    }),
    run: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:launch:run",
      tag: WS_METHODS.launchRun,
      scheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.threadId]),
      },
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:launch:stop",
      tag: WS_METHODS.launchStop,
    }),
  };
}
