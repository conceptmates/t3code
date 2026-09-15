import { assert, describe, it } from "vite-plus/test";

import {
  hasSpecificPierreIconForFileName,
  materialFolderColorsForPath,
  resolvePierreIconForEntry,
  syntheticFileNameForLanguageId,
  T3_PIERRE_ICONS,
} from "./pierre-icons";

describe("Pierre file icons", () => {
  it("uses Pierre exact filename and complete-set extension mappings", () => {
    assert.equal(resolvePierreIconForEntry("Dockerfile", "file")?.token, "docker");
    assert.equal(resolvePierreIconForEntry("src/Button.tsx", "file")?.token, "react");
    assert.equal(resolvePierreIconForEntry("vite.config.ts", "file")?.token, "vite");
  });

  it("uses built-in Pierre icons where available", () => {
    assert.equal(resolvePierreIconForEntry("package.json", "file")?.name, "file-tree-builtin-npm");
    assert.equal(
      resolvePierreIconForEntry("config/tsconfig.json", "file")?.name,
      "file-tree-builtin-typescript",
    );
    assert.equal(resolvePierreIconForEntry("CLAUDE.md", "file")?.name, "file-tree-builtin-claude");
    assert.equal(
      resolvePierreIconForEntry("README.md", "file")?.name,
      "file-tree-builtin-markdown",
    );
  });

  it("extends Pierre with T3-specific exact filename icons", () => {
    assert.equal(resolvePierreIconForEntry("AGENTS.md", "file")?.name, "t3-file-icon-agents");
    assert.equal(resolvePierreIconForEntry("pnpm-lock.yaml", "file")?.name, "t3-file-icon-pnpm");
    assert.equal(
      resolvePierreIconForEntry("pnpm-workspace.yaml", "file")?.name,
      "t3-file-icon-pnpm",
    );
  });

  it("ships every custom icon referenced by the extended resolver", () => {
    const customIconNames = new Set(
      Object.values(T3_PIERRE_ICONS.byFileName)
        .map((entry) => (typeof entry === "string" ? entry : entry.name))
        .filter((name) => name.startsWith("t3-")),
    );
    for (const iconName of customIconNames) {
      assert.include(T3_PIERRE_ICONS.spriteSheet, `id="${iconName}"`);
    }
  });

  it("uses the Pierre default icon for unknown file types", () => {
    assert.equal(resolvePierreIconForEntry("artifact.unknown-ext", "file")?.token, "default");
    assert.isFalse(hasSpecificPierreIconForFileName("artifact.unknown-ext"));
  });

  it("leaves directory rendering to the shared folder fallback", () => {
    assert.isNull(resolvePierreIconForEntry("packages/client-runtime", "directory"));
  });

  it("normalizes common markdown fence language aliases", () => {
    assert.equal(syntheticFileNameForLanguageId("typescript"), "file.ts");
    assert.equal(syntheticFileNameForLanguageId("shellscript"), "file.sh");
    assert.equal(syntheticFileNameForLanguageId("python"), "file.py");
  });
});

describe("Material file cover", () => {
  it("maps dotfiles and tool configs to specific tokens", () => {
    assert.isTrue(hasSpecificPierreIconForFileName(".gitignore"));
    assert.isTrue(hasSpecificPierreIconForFileName(".mcp.json"));
    assert.isTrue(hasSpecificPierreIconForFileName(".env"));
    assert.isTrue(hasSpecificPierreIconForFileName("Dockerfile"));
    assert.isTrue(hasSpecificPierreIconForFileName("go.mod"));
  });

  it("matches substrings for versioned env files and tsconfigs", () => {
    assert.isTrue(hasSpecificPierreIconForFileName(".env.local"));
    assert.isTrue(hasSpecificPierreIconForFileName("tsconfig.node.json"));
    assert.isTrue(hasSpecificPierreIconForFileName("docker-compose.override.yml"));
  });

  it("carries color tokens on overrides (glyph alone would render gray)", () => {
    assert.equal(resolvePierreIconForEntry(".env", "file")?.token, "database");
    assert.equal(resolvePierreIconForEntry(".env.local", "file")?.token, "database");
    assert.equal(resolvePierreIconForEntry("go.mod", "file")?.token, "go");
  });
});

describe("materialFolderColorsForPath", () => {
  it("tints well-known folders by basename", () => {
    assert.equal(materialFolderColorsForPath("node_modules")[0], "#199f43");
    assert.equal(materialFolderColorsForPath("src")[0], "#1a85d4");
    assert.equal(materialFolderColorsForPath("patches")[0], "#d52c36");
  });

  it("matches the last path segment case-insensitively", () => {
    assert.deepEqual(
      materialFolderColorsForPath("apps/web/SRC"),
      materialFolderColorsForPath("src"),
    );
  });

  it("falls back to blue for unknown folders", () => {
    assert.equal(materialFolderColorsForPath("some-random-dir")[0], "#1a85d4");
  });
});
