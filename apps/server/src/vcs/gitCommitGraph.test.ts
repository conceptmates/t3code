import { describe, expect, it } from "@effect/vitest";

import {
  buildRefIndex,
  mergeCommitFiles,
  outputNeedsTerminal,
  parseCommitGraphLog,
  parseNameStatus,
  parseNumstat,
  parseRefRecords,
  parseWorkingCopyStatus,
} from "./gitCommitGraph.ts";

const RS = "\x1e";
const FS = "\x1f";

function logRecord(fields: ReadonlyArray<string>): string {
  return `${RS}${fields.join(FS)}`;
}

describe("parseRefRecords / buildRefIndex", () => {
  it("resolves tags through their peeled object and marks the checked-out branch", () => {
    const records = parseRefRecords(
      [
        `aaa${FS}${FS}refs/heads/main`,
        `bbb${FS}${FS}refs/heads/feat/launch-configs`,
        `ccc${FS}${FS}refs/remotes/origin/main`,
        `ddd${FS}${FS}refs/remotes/origin/HEAD`,
        `eee${FS}aaa${FS}refs/tags/v1.0.0`,
        "",
      ].join("\n"),
    );

    const index = buildRefIndex(records, "refs/heads/main");

    expect(index.get("aaa")).toEqual([
      { name: "main", kind: "branch", isHead: true },
      { name: "v1.0.0", kind: "tag", isHead: false },
    ]);
    expect(index.get("bbb")).toEqual([
      { name: "feat/launch-configs", kind: "branch", isHead: false },
    ]);
    // A branch name with a slash is local, not a remote.
    expect(index.get("ccc")).toEqual([{ name: "origin/main", kind: "remote", isHead: false }]);
    // origin/HEAD is a symbolic pointer and gets no chip.
    expect(index.get("ddd")).toBeUndefined();
  });
});

describe("parseCommitGraphLog", () => {
  it("keeps a multi-line body in one field and splits merge parents", () => {
    const stdout = [
      logRecord([
        "a".repeat(40),
        "aaaaaaa",
        `${"b".repeat(40)} ${"c".repeat(40)}`,
        "Ada",
        "ada@example.com",
        "1700000000",
        "feat: merge the thing",
        "Body line one\nBody line two\n\n",
      ]),
      logRecord([
        "b".repeat(40),
        "bbbbbbb",
        "",
        "Grace",
        "grace@example.com",
        "1699999999",
        "chore: first commit",
        "",
      ]),
    ].join("");

    const commits = parseCommitGraphLog(stdout, new Map(), null);

    expect(commits).toHaveLength(2);
    expect(commits[0]?.parents).toEqual(["b".repeat(40), "c".repeat(40)]);
    expect(commits[0]?.body).toBe("Body line one\nBody line two");
    expect(commits[0]?.authoredAt).toBe(1_700_000_000_000);
    expect(commits[1]?.parents).toEqual([]);
  });

  it("labels a detached HEAD commit", () => {
    const sha = "d".repeat(40);
    const stdout = logRecord([sha, "ddddddd", "", "Ada", "ada@example.com", "1700000000", "s", ""]);

    const commits = parseCommitGraphLog(stdout, new Map(), sha);

    expect(commits[0]?.refs).toEqual([{ name: "HEAD", kind: "head", isHead: true }]);
  });
});

describe("parseNumstat", () => {
  it("reads inline paths, rename pairs, and binary markers", () => {
    const stdout = [
      "12\t3\tsrc/a.ts\0",
      "0\t0\t\0src/old.ts\0src/new.ts\0",
      "-\t-\tlogo.png\0",
    ].join("");

    expect(parseNumstat(stdout)).toEqual([
      { path: "src/a.ts", oldPath: null, insertions: 12, deletions: 3, binary: false },
      { path: "src/new.ts", oldPath: "src/old.ts", insertions: 0, deletions: 0, binary: false },
      { path: "logo.png", oldPath: null, insertions: null, deletions: null, binary: true },
    ]);
  });
});

describe("parseNameStatus / mergeCommitFiles", () => {
  it("maps rename scores onto the new path", () => {
    const statuses = parseNameStatus("M\0src/a.ts\0R100\0src/old.ts\0src/new.ts\0A\0src/b.ts\0");

    expect(statuses.get("src/a.ts")).toBe("modified");
    expect(statuses.get("src/new.ts")).toBe("renamed");
    expect(statuses.get("src/b.ts")).toBe("added");
  });

  it("falls back to modified when name-status is missing an entry", () => {
    const merged = mergeCommitFiles(
      [{ path: "src/a.ts", oldPath: null, insertions: 1, deletions: 0, binary: false }],
      new Map(),
    );

    expect(merged[0]?.status).toBe("modified");
  });
});

describe("parseWorkingCopyStatus", () => {
  it("splits index and worktree halves and reads the branch header", () => {
    const stdout = [
      "# branch.oid 1234abc\0",
      "# branch.head main\0",
      "1 M. N... 100644 100644 100644 aaa bbb src/staged.ts\0",
      "1 .M N... 100644 100644 100644 aaa bbb src/unstaged.ts\0",
      "1 MM N... 100644 100644 100644 aaa bbb src/both.ts\0",
      "2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts\0src/old.ts\0",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts\0",
      "? src/untracked.ts\0",
    ].join("");

    const status = parseWorkingCopyStatus(stdout);

    expect(status.branch).toBe("main");
    expect(status.isUnborn).toBe(false);
    expect(status.staged.map((file) => file.path)).toEqual([
      "src/staged.ts",
      "src/both.ts",
      "src/new.ts",
    ]);
    expect(status.staged.find((file) => file.path === "src/new.ts")).toMatchObject({
      status: "renamed",
      oldPath: "src/old.ts",
    });
    // A path with both halves dirty appears in each list, as VS Code shows it.
    expect(status.unstaged.map((file) => file.path)).toEqual([
      "src/unstaged.ts",
      "src/both.ts",
      "src/untracked.ts",
    ]);
    expect(status.conflicted.map((file) => file.path)).toEqual(["src/conflict.ts"]);
  });

  it("reports an unborn branch before the first commit", () => {
    const status = parseWorkingCopyStatus("# branch.oid (initial)\0# branch.head main\0");

    expect(status.isUnborn).toBe(true);
    expect(status.branch).toBe("main");
  });

  it("reports a detached head as no branch", () => {
    const status = parseWorkingCopyStatus("# branch.oid abc\0# branch.head (detached)\0");

    expect(status.branch).toBeNull();
  });

  it("keeps spaces in paths", () => {
    const status = parseWorkingCopyStatus(
      "1 M. N... 100644 100644 100644 aaa bbb src/my file.ts\0",
    );

    expect(status.staged[0]?.path).toBe("src/my file.ts");
  });
});

describe("outputNeedsTerminal", () => {
  it("recognises the prompts the panel cannot answer", () => {
    expect(outputNeedsTerminal("error: gpg failed to sign the data")).toBe(true);
    expect(outputNeedsTerminal("fatal: could not read Username for 'https://github.com'")).toBe(
      true,
    );
    expect(outputNeedsTerminal("husky - pre-commit hook exited with code 1")).toBe(false);
  });
});
