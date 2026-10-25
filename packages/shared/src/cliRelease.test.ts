import { describe, expect, it } from "vite-plus/test";

import {
  cliArchiveTarCommand,
  newestCliReleaseVersion,
  newestInstallableCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  t3-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *t3-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("t3-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("t3-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
  });

  it("picks the newest installable release, preferring stable and skipping preview", () => {
    const checksums = [{ name: "SHA256SUMS" }];
    const releases = [
      { tag_name: "v1.2.5-preview.20260913.9", assets: checksums },
      { tag_name: "v1.2.5-nightly.20260913.8", draft: true, assets: checksums },
      { tag_name: "v1.2.4-nightly.20260912.7", assets: checksums },
      // Older, but stable wins over any nightly.
      { tag_name: "v1.2.3", assets: checksums },
    ];
    expect(newestInstallableCliReleaseVersion(releases)).toBe("1.2.3");

    // A release that only carried desktop installers is not installable.
    const desktopOnly = [
      { tag_name: "v1.2.3", assets: [{ name: "T3-Code-1.2.3-arm64.dmg" }] },
      { tag_name: "v1.2.2-nightly.20260911.1", assets: checksums },
    ];
    expect(newestInstallableCliReleaseVersion(desktopOnly)).toBe("1.2.2-nightly.20260911.1");
    expect(newestInstallableCliReleaseVersion([{ tag_name: "v1.2.3" }])).toBeUndefined();
  });
});
