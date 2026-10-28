import { assert, describe, it } from "vite-plus/test";

import { MATERIAL_ICON_SPRITE } from "./materialIcons.generated";
import {
  documentChipKindForFileName,
  hasSpecificPierreIconForFileName,
  resolvePierreIconForEntry,
  syntheticFileNameForLanguageId,
  T3_PIERRE_ICONS,
} from "./pierre-icons";

const spriteSymbolIds = new Set(
  [...MATERIAL_ICON_SPRITE.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]),
);

describe("file icon resolution", () => {
  it("matches exact filenames", () => {
    assert.equal(resolvePierreIconForEntry("package.json", "file").name, "mi-nodejs");
    assert.equal(resolvePierreIconForEntry("config/tsconfig.json", "file").name, "mi-tsconfig");
    assert.equal(resolvePierreIconForEntry("Dockerfile", "file").name, "mi-docker");
  });

  it("falls back to progressively shorter extensions", () => {
    assert.equal(resolvePierreIconForEntry("src/Button.tsx", "file").name, "mi-react_ts");
    assert.equal(
      resolvePierreIconForEntry("src/Button.test.tsx", "file").name,
      resolvePierreIconForEntry("src/Button.spec.tsx", "file").name,
    );
  });

  it("maps agent files upstream leaves generic", () => {
    assert.equal(resolvePierreIconForEntry("CLAUDE.md", "file").name, "mi-claude");
    assert.equal(resolvePierreIconForEntry("AGENTS.md", "file").name, "mi-agent");
  });

  it("uses the detected type for extensionless files without a name rule", () => {
    assert.equal(
      resolvePierreIconForEntry("custom-script", "file", "text/x-python").name,
      resolvePierreIconForEntry("file.py", "file").name,
    );
    assert.equal(
      resolvePierreIconForEntry("Dockerfile", "file", "text/x-shellscript").name,
      "mi-docker",
    );
    assert.equal(
      resolvePierreIconForEntry("unknown", "file", "application/octet-stream").name,
      "mi-file",
    );
  });

  it.each(["photo.heic", "photo.heif", "PHOTO.HEIC", "folder/photo.HEIF"])(
    "uses the image icon for %s",
    (name) => {
      assert.equal(resolvePierreIconForEntry(name, "file").name, "mi-image");
      assert.isTrue(hasSpecificPierreIconForFileName(name));
    },
  );

  it.each([
    ["pdf", "mi-pdf"],
    ["docx", "mi-word"],
    ["odt", "mi-word"],
    ["xlsx", "mi-table"],
    ["csv", "mi-table"],
    ["pptx", "mi-powerpoint"],
    ["epub", "mi-epub"],
  ])("gives %s documents their family icon and accent color", (extension, icon) => {
    for (const path of [`report.${extension}`, `folder/REPORT.${extension.toUpperCase()}`]) {
      assert.equal(resolvePierreIconForEntry(path, "file").name, icon);
      assert.isString(documentChipKindForFileName(path));
    }
    assert.isUndefined(documentChipKindForFileName("src/index.ts"));
  });

  it("uses the generic file glyph for unknown types", () => {
    assert.equal(resolvePierreIconForEntry("artifact.unknown-ext", "file").name, "mi-file");
    assert.isFalse(hasSpecificPierreIconForFileName("artifact.unknown-ext"));
    assert.isTrue(hasSpecificPierreIconForFileName(".gitignore"));
  });

  it("resolves folders by basename, case-insensitively", () => {
    assert.equal(resolvePierreIconForEntry("apps/web/SRC", "directory").name, "mi-folder-src");
    assert.equal(resolvePierreIconForEntry("node_modules", "directory").name, "mi-folder-node");
    assert.equal(resolvePierreIconForEntry("some-random-dir", "directory").name, "mi-folder");
  });

  it("normalizes common markdown fence language aliases", () => {
    assert.equal(syntheticFileNameForLanguageId("typescript"), "file.ts");
    assert.equal(syntheticFileNameForLanguageId("dockerfile"), "Dockerfile");
    assert.equal(syntheticFileNameForLanguageId("shellscript"), "file.sh");
    assert.equal(syntheticFileNameForLanguageId("python"), "file.py");
  });

  it("gives a dockerfile fence the Docker icon", () => {
    assert.isTrue(hasSpecificPierreIconForFileName(syntheticFileNameForLanguageId("dockerfile")));
  });

  it.each([
    "csharp",
    "dart",
    "diff",
    "elixir",
    "haskell",
    "java",
    "kotlin",
    "lua",
    "php",
    "powershell",
    "r",
    "scala",
    "toml",
    "xml",
  ])("gives a %s fence a language icon", (language) => {
    assert.isTrue(hasSpecificPierreIconForFileName(syntheticFileNameForLanguageId(language)));
  });
});

describe("generated Material sprite", () => {
  it("ships a symbol for every icon the rules can return", () => {
    const referenced = new Set([
      ...Object.values(T3_PIERRE_ICONS.byFileName),
      ...Object.values(T3_PIERRE_ICONS.byFileExtension),
      T3_PIERRE_ICONS.remap["file-tree-icon-file"],
    ]);
    for (const symbolId of referenced) {
      assert.isTrue(spriteSymbolIds.has(symbolId), `sprite is missing ${symbolId}`);
    }
  });

  it("keeps every id unique, so one icon's gradient cannot capture another's", () => {
    const ids = [...MATERIAL_ICON_SPRITE.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("keeps internal references pointing inside their own icon", () => {
    for (const match of MATERIAL_ICON_SPRITE.matchAll(/url\(#([^)]+)\)/g)) {
      assert.include(match[1] ?? "", "__", `${match[0]} was not namespaced`);
    }
  });
});
