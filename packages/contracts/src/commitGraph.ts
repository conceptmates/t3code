import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Contracts for the Source Control surface: commit history, working copy
 * staging, and committing. History is paged because a repository's log is
 * unbounded and every row crosses the websocket.
 */

/** Upper bound the server enforces on a single history page. */
export const COMMIT_GRAPH_MAX_PAGE_SIZE = 500;

/** Page size clients ask for unless they have a reason not to. */
export const COMMIT_GRAPH_DEFAULT_PAGE_SIZE = 200;

export const CommitGraphRefKind = Schema.Literals(["branch", "remote", "tag", "head"]);
export type CommitGraphRefKind = typeof CommitGraphRefKind.Type;

export const CommitGraphRef = Schema.Struct({
  /** Short display name: `main`, `origin/main`, `v1.2.0`. */
  name: TrimmedNonEmptyString,
  kind: CommitGraphRefKind,
  /** True for the ref `HEAD` currently points at. */
  isHead: Schema.Boolean,
});
export type CommitGraphRef = typeof CommitGraphRef.Type;

export const CommitGraphCommit = Schema.Struct({
  sha: TrimmedNonEmptyString,
  /** Abbreviated sha as git itself chose to abbreviate it. */
  shortSha: TrimmedNonEmptyString,
  /** Ordered parents; more than one means a merge. */
  parents: Schema.Array(TrimmedNonEmptyString),
  subject: Schema.String,
  body: Schema.String,
  authorName: Schema.String,
  authorEmail: Schema.String,
  /** Author time in epoch milliseconds. */
  authoredAt: Schema.Number,
  refs: Schema.Array(CommitGraphRef),
});
export type CommitGraphCommit = typeof CommitGraphCommit.Type;

export const CommitGraphListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  limit: Schema.optionalKey(PositiveInt),
  /** Number of commits already received; the next page starts after them. */
  skip: Schema.optionalKey(NonNegativeInt),
});
export type CommitGraphListInput = typeof CommitGraphListInput.Type;

export const CommitGraphListResult = Schema.Struct({
  isRepo: Schema.Boolean,
  commits: Schema.Array(CommitGraphCommit),
  /** Another page exists after this one. */
  hasMore: Schema.Boolean,
  /** Null in a repository with no commits yet. */
  headSha: Schema.NullOr(TrimmedNonEmptyString),
  /** Null when HEAD is detached. */
  branch: Schema.NullOr(TrimmedNonEmptyString),
});
export type CommitGraphListResult = typeof CommitGraphListResult.Type;

export const CommitGraphFileStatus = Schema.Literals([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "untracked",
  "conflicted",
]);
export type CommitGraphFileStatus = typeof CommitGraphFileStatus.Type;

export const CommitGraphFileChange = Schema.Struct({
  path: TrimmedNonEmptyString,
  /** Previous path for renames and copies, null otherwise. */
  oldPath: Schema.NullOr(TrimmedNonEmptyString),
  status: CommitGraphFileStatus,
  /** Null when line counts were not computed, as in the working copy listing. */
  insertions: Schema.NullOr(NonNegativeInt),
  deletions: Schema.NullOr(NonNegativeInt),
  /** Git reported the change as binary, so it has no line counts. */
  binary: Schema.Boolean,
});
export type CommitGraphFileChange = typeof CommitGraphFileChange.Type;

export const CommitGraphCommitFilesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sha: TrimmedNonEmptyString,
});
export type CommitGraphCommitFilesInput = typeof CommitGraphCommitFilesInput.Type;

export const CommitGraphCommitFilesResult = Schema.Struct({
  files: Schema.Array(CommitGraphFileChange),
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type CommitGraphCommitFilesResult = typeof CommitGraphCommitFilesResult.Type;

export const WorkingCopyStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type WorkingCopyStatusInput = typeof WorkingCopyStatusInput.Type;

/**
 * A path can appear in both `staged` and `unstaged` when the index and the
 * working tree disagree, which is exactly what VS Code shows as two rows.
 */
export const WorkingCopyStatusResult = Schema.Struct({
  isRepo: Schema.Boolean,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  /** True before the first commit; committing then has no parent. */
  isUnborn: Schema.Boolean,
  staged: Schema.Array(CommitGraphFileChange),
  unstaged: Schema.Array(CommitGraphFileChange),
  conflicted: Schema.Array(CommitGraphFileChange),
});
export type WorkingCopyStatusResult = typeof WorkingCopyStatusResult.Type;

export const WorkingCopyStageInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  paths: Schema.Array(TrimmedNonEmptyString),
  /** True stages the paths, false unstages them. */
  staged: Schema.Boolean,
});
export type WorkingCopyStageInput = typeof WorkingCopyStageInput.Type;

export const WorkingCopyStageResult = Schema.Struct({
  stagedCount: NonNegativeInt,
});
export type WorkingCopyStageResult = typeof WorkingCopyStageResult.Type;

export const WorkingCopyCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  /** Stage every tracked change first, for the "nothing staged" case. */
  stageAll: Schema.optionalKey(Schema.Boolean),
  amend: Schema.optionalKey(Schema.Boolean),
  /** Push the current branch after the commit succeeds. */
  push: Schema.optionalKey(Schema.Boolean),
});
export type WorkingCopyCommitInput = typeof WorkingCopyCommitInput.Type;

export const WorkingCopyCommitResult = Schema.Struct({
  commitSha: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  push: Schema.NullOr(
    Schema.Struct({
      status: Schema.Literals(["pushed", "skipped_up_to_date"]),
      branch: TrimmedNonEmptyString,
      setUpstream: Schema.Boolean,
    }),
  ),
});
export type WorkingCopyCommitResult = typeof WorkingCopyCommitResult.Type;

/** Bytes of patch text a single file view will carry over the wire. */
export const COMMIT_PATCH_MAX_BYTES = 512 * 1024;

export const CommitPatchInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sha: TrimmedNonEmptyString,
  /** Limits the patch to one file; omit for the whole commit. */
  path: Schema.optionalKey(TrimmedNonEmptyString),
});
export type CommitPatchInput = typeof CommitPatchInput.Type;

export const CommitPatchResult = Schema.Struct({
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type CommitPatchResult = typeof CommitPatchResult.Type;

export const CommitMessageSuggestionInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Lets the server pick up per-project writing-style settings. */
  threadId: Schema.optionalKey(ThreadId),
});
export type CommitMessageSuggestionInput = typeof CommitMessageSuggestionInput.Type;

export const CommitMessageSuggestionResult = Schema.Struct({
  subject: TrimmedNonEmptyString,
  body: Schema.String,
  /** Subject and body joined the way the commit box wants them. */
  message: TrimmedNonEmptyString,
});
export type CommitMessageSuggestionResult = typeof CommitMessageSuggestionResult.Type;

/** Bytes of hook output kept for the client. Hooks can print a lot. */
export const COMMIT_OUTPUT_MAX_BYTES = 16 * 1024;

/**
 * Carries the command output, unlike `GitCommandError`. A failing commit is
 * almost always a pre-commit hook and the output is the whole answer, so the
 * panel renders it verbatim.
 */
export class WorkingCopyCommitFailedError extends Schema.TaggedError<WorkingCopyCommitFailedError>()(
  "WorkingCopyCommitFailedError",
  {
    cwd: Schema.String,
    /** `commit`, `stage`, or `push`, so the panel can say which step failed. */
    step: Schema.Literals(["stage", "commit", "push"]),
    exitCode: Schema.Number,
    output: Schema.String,
    outputTruncated: Schema.Boolean,
    /** Git was waiting on a terminal, e.g. a GPG passphrase or credentials. */
    needsTerminal: Schema.Boolean,
  },
) {
  override get message(): string {
    return `Git ${this.step} failed in ${this.cwd} with exit code ${this.exitCode}`;
  }
}
