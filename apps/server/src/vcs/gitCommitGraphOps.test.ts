import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { assert, describe, it } from "@effect/vitest";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";

const TestLayer = Layer.mergeAll(GitVcsDriver.vcsLayer, GitVcsDriver.layer).pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-commit-graph-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    yield* driver.execute({ operation: "test.git", cwd, args, timeoutMs: 15_000 });
  });

const writeFile = (cwd: string, relativePath: string, contents: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePath = path.join(cwd, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
    yield* fileSystem.writeFileString(absolutePath, contents);
  });

/** An empty repository on `main`, with signing off so hosts with keys still pass. */
const makeRepo = Effect.fn("test.makeRepo")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-commit-graph-repo-" });
  yield* runGit(cwd, ["init", "--initial-branch=main"]);
  yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
  yield* runGit(cwd, ["config", "user.name", "Test"]);
  yield* runGit(cwd, ["config", "commit.gpgsign", "false"]);
  return cwd;
});

describe("commitGraph driver operations", () => {
  it.effect("reports a non-repository directory instead of failing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const driver = yield* GitVcsDriver.makeVcsDriverShape();
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-commit-graph-bare-" });

      const listed = yield* driver.commitGraph.listCommits({ cwd });
      const status = yield* driver.commitGraph.readWorkingCopy({ cwd });

      assert.isFalse(listed.isRepo);
      assert.deepStrictEqual(listed.commits, []);
      assert.isFalse(status.isRepo);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("lists an empty repository with its branch name", () =>
    Effect.gen(function* () {
      const driver = yield* GitVcsDriver.makeVcsDriverShape();
      const cwd = yield* makeRepo();

      const listed = yield* driver.commitGraph.listCommits({ cwd });

      assert.isTrue(listed.isRepo);
      assert.strictEqual(listed.branch, "main");
      assert.isNull(listed.headSha);
      assert.deepStrictEqual(listed.commits, []);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("pages history newest first and tags the checked-out branch", () =>
    Effect.gen(function* () {
      const driver = yield* GitVcsDriver.makeVcsDriverShape();
      const cwd = yield* makeRepo();

      for (const index of [1, 2, 3]) {
        yield* writeFile(cwd, `file-${index}.txt`, `${index}\n`);
        yield* runGit(cwd, ["add", "."]);
        yield* runGit(cwd, ["commit", "-m", `commit ${index}`]);
      }
      yield* runGit(cwd, ["tag", "v1"]);

      const firstPage = yield* driver.commitGraph.listCommits({ cwd, limit: 2 });
      assert.isTrue(firstPage.hasMore);
      assert.deepStrictEqual(
        firstPage.commits.map((commit) => commit.subject),
        ["commit 3", "commit 2"],
      );
      assert.strictEqual(firstPage.branch, "main");
      assert.strictEqual(firstPage.headSha, firstPage.commits[0]?.sha);
      assert.deepStrictEqual(firstPage.commits[0]?.refs, [
        { name: "main", kind: "branch", isHead: true },
        { name: "v1", kind: "tag", isHead: false },
      ]);

      const secondPage = yield* driver.commitGraph.listCommits({ cwd, limit: 2, skip: 2 });
      assert.isFalse(secondPage.hasMore);
      assert.deepStrictEqual(
        secondPage.commits.map((commit) => commit.subject),
        ["commit 1"],
      );
      assert.deepStrictEqual(secondPage.commits[0]?.parents, []);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("leaves T3 checkpoint refs out of the history", () =>
    Effect.gen(function* () {
      const driver = yield* GitVcsDriver.makeVcsDriverShape();
      const cwd = yield* makeRepo();

      yield* writeFile(cwd, "a.txt", "a\n");
      yield* runGit(cwd, ["add", "."]);
      yield* runGit(cwd, ["commit", "-m", "base"]);
      yield* writeFile(cwd, "b.txt", "b\n");
      yield* runGit(cwd, ["add", "."]);
      yield* runGit(cwd, ["commit", "-m", "checkpointed"]);
      yield* runGit(cwd, ["update-ref", "refs/t3/checkpoints/one", "HEAD"]);
      yield* runGit(cwd, ["reset", "--hard", "HEAD~1"]);

      const listed = yield* driver.commitGraph.listCommits({ cwd });

      assert.deepStrictEqual(
        listed.commits.map((commit) => commit.subject),
        ["base"],
      );
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("reads the files of a root commit and of a later commit", () =>
    Effect.gen(function* () {
      const driver = yield* GitVcsDriver.makeVcsDriverShape();
      const cwd = yield* makeRepo();

      yield* writeFile(cwd, "a.txt", "one\ntwo\n");
      yield* runGit(cwd, ["add", "."]);
      yield* runGit(cwd, ["commit", "-m", "root"]);
      const rootSha = (yield* driver.commitGraph.listCommits({ cwd })).headSha ?? "";

      yield* writeFile(cwd, "a.txt", "one\ntwo\nthree\n");
      yield* runGit(cwd, ["rm", "-q", "--cached", "a.txt"]);
      yield* runGit(cwd, ["add", "a.txt"]);
      yield* runGit(cwd, ["commit", "-m", "edit"]);
      const editSha = (yield* driver.commitGraph.listCommits({ cwd })).headSha ?? "";

      const root = yield* driver.commitGraph.readCommitFiles({ cwd, sha: rootSha });
      assert.deepStrictEqual(root.files, [
        {
          path: "a.txt",
          oldPath: null,
          status: "added",
          insertions: 2,
          deletions: 0,
          binary: false,
        },
      ]);

      const edit = yield* driver.commitGraph.readCommitFiles({ cwd, sha: editSha });
      assert.strictEqual(edit.insertions, 1);
      assert.strictEqual(edit.deletions, 0);
      assert.strictEqual(edit.files[0]?.status, "modified");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("stages and unstages the paths it is given", () =>
    Effect.gen(function* () {
      const driver = yield* GitVcsDriver.makeVcsDriverShape();
      const cwd = yield* makeRepo();

      yield* writeFile(cwd, "tracked.txt", "one\n");
      yield* runGit(cwd, ["add", "."]);
      yield* runGit(cwd, ["commit", "-m", "base"]);
      yield* writeFile(cwd, "tracked.txt", "two\n");
      yield* writeFile(cwd, "fresh.txt", "new\n");

      const dirty = yield* driver.commitGraph.readWorkingCopy({ cwd });
      assert.deepStrictEqual(dirty.staged, []);
      assert.deepStrictEqual(
        dirty.unstaged.map((file) => [file.path, file.status]),
        [
          ["tracked.txt", "modified"],
          ["fresh.txt", "untracked"],
        ],
      );

      yield* driver.commitGraph.setStaged({ cwd, paths: ["fresh.txt"], staged: true });
      const staged = yield* driver.commitGraph.readWorkingCopy({ cwd });
      assert.deepStrictEqual(
        staged.staged.map((file) => [file.path, file.status]),
        [["fresh.txt", "added"]],
      );

      yield* driver.commitGraph.setStaged({ cwd, paths: ["fresh.txt"], staged: false });
      const unstaged = yield* driver.commitGraph.readWorkingCopy({ cwd });
      assert.deepStrictEqual(unstaged.staged, []);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("unstages before the first commit, where there is no HEAD to restore from", () =>
    Effect.gen(function* () {
      const driver = yield* GitVcsDriver.makeVcsDriverShape();
      const cwd = yield* makeRepo();

      yield* writeFile(cwd, "first.txt", "one\n");
      yield* driver.commitGraph.setStaged({ cwd, paths: ["first.txt"], staged: true });
      assert.isTrue((yield* driver.commitGraph.readWorkingCopy({ cwd })).isUnborn);

      yield* driver.commitGraph.setStaged({ cwd, paths: ["first.txt"], staged: false });

      const status = yield* driver.commitGraph.readWorkingCopy({ cwd });
      assert.deepStrictEqual(status.staged, []);
      assert.deepStrictEqual(
        status.unstaged.map((file) => file.path),
        ["first.txt"],
      );
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("commits the index, and commits everything tracked with stageAll", () =>
    Effect.gen(function* () {
      const driver = yield* GitVcsDriver.makeVcsDriverShape();
      const cwd = yield* makeRepo();

      yield* writeFile(cwd, "a.txt", "one\n");
      yield* driver.commitGraph.setStaged({ cwd, paths: ["a.txt"], staged: true });
      const first = yield* driver.commitGraph.commit({ cwd, message: "feat: first\n\nbody" });
      assert.strictEqual(first.branch, "main");
      assert.isAbove(first.commitSha.length, 0);

      yield* writeFile(cwd, "a.txt", "two\n");
      yield* writeFile(cwd, "untracked.txt", "skip me\n");
      yield* driver.commitGraph.commit({ cwd, message: "fix: second", stageAll: true });

      const listed = yield* driver.commitGraph.listCommits({ cwd });
      assert.deepStrictEqual(
        listed.commits.map((commit) => commit.subject),
        ["fix: second", "feat: first"],
      );
      assert.strictEqual(listed.commits[1]?.body, "body");
      // `stageAll` matches `git commit -a`, so the new file is still untracked.
      assert.deepStrictEqual(
        (yield* driver.commitGraph.readWorkingCopy({ cwd })).unstaged.map((file) => file.path),
        ["untracked.txt"],
      );
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("returns the hook output when a pre-commit hook rejects the commit", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const driver = yield* GitVcsDriver.makeVcsDriverShape();
      const cwd = yield* makeRepo();

      const hookPath = path.join(cwd, ".git", "hooks", "pre-commit");
      yield* fileSystem.writeFileString(
        hookPath,
        "#!/bin/sh\necho 'lint failed on src/a.ts'\nexit 1\n",
      );
      yield* fileSystem.chmod(hookPath, 0o755);

      yield* writeFile(cwd, "a.txt", "one\n");
      yield* driver.commitGraph.setStaged({ cwd, paths: ["a.txt"], staged: true });

      const failure = yield* driver.commitGraph
        .commit({ cwd, message: "feat: blocked" })
        .pipe(Effect.flip);

      if (failure._tag !== "WorkingCopyCommitFailedError") {
        assert.fail(`expected a commit failure, got ${failure._tag}`);
      }
      assert.strictEqual(failure.step, "commit");
      assert.include(failure.output, "lint failed on src/a.ts");
      assert.isFalse(failure.needsTerminal);
    }).pipe(Effect.provide(TestLayer)),
  );
});
