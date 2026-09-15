import { createLaunchEnvironmentAtoms } from "@t3tools/client-runtime/state/launch";

import { connectionAtomRuntime } from "../connection/runtime";

export const launchEnvironment = createLaunchEnvironmentAtoms(connectionAtomRuntime);
