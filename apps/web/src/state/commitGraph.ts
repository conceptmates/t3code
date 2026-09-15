import { createCommitGraphEnvironmentAtoms } from "@t3tools/client-runtime/state/commit-graph";

import { connectionAtomRuntime } from "../connection/runtime";

export const commitGraphEnvironment = createCommitGraphEnvironmentAtoms(connectionAtomRuntime);
