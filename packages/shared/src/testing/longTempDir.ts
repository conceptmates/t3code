// @effect-diagnostics nodeBuiltinImport:off - runs once at test setup, outside any Effect runtime.
import * as NodeFS from "node:fs";
import { HostProcessPlatform } from "../hostProcess.ts";

// Temp directories are compared against their canonical form throughout the
// suites: sources under test resolve symlinks before comparing paths
// (workspace containment, installer ownership), while fixtures build
// expectations from `os.tmpdir()`. When the temp dir itself passes through a
// symlink the two disagree and every such assertion fails:
// - GitHub's Windows runners hand out the temp directory by its 8.3 short
//   name (C:\Users\RUNNER~1\...); anything that canonicalises a path, such as
//   git or realpath, reports the long form.
// - macOS TMPDIR passes through the `/var` → `/private/var` symlink.
// Node reads the temp-dir variables on every os.tmpdir() call, so pointing
// them at the canonical form fixes every temp directory the suite makes.
const platform = HostProcessPlatform.defaultValue();
const candidates = platform === "win32" ? ["TEMP", "TMP"] : ["TMPDIR", "TEMP", "TMP"];
for (const name of candidates) {
  const raw = process.env[name];
  if (!raw) continue;
  try {
    const canonical =
      platform === "win32" ? NodeFS.realpathSync.native(raw) : NodeFS.realpathSync(raw);
    if (canonical !== raw) {
      process.env[name] = canonical;
    }
  } catch {
    // Leave the host's value alone if it cannot be resolved.
  }
}
