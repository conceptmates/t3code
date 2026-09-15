import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  CommitGraphCommitFilesInput,
  CommitGraphCommitFilesResult,
  CommitGraphListInput,
  CommitGraphListResult,
  CommitPatchInput,
  CommitPatchResult,
  VcsDriverCapabilities,
  VcsError,
  VcsInitInput,
  VcsListRemotesResult,
  VcsListWorkspaceFilesResult,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
  VcsRepositoryIdentity,
  WorkingCopyCommitFailedError,
  WorkingCopyCommitInput,
  WorkingCopyStageInput,
  WorkingCopyStageResult,
  WorkingCopyStatusInput,
  WorkingCopyStatusResult,
} from "@t3tools/contracts";
import { CheckpointRef } from "@t3tools/contracts";
import * as VcsProcess from "./VcsProcess.ts";

export interface VcsCaptureCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
}

export interface VcsRestoreCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  readonly fallbackToHead?: boolean;
}

export interface VcsDiffCheckpointsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  readonly fallbackFromToHead?: boolean;
  readonly ignoreWhitespace: boolean;
  readonly format?: "patch" | "numstat";
}

export interface VcsDeleteCheckpointRefsInput {
  readonly cwd: string;
  readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
}

export interface VcsCheckpointOps {
  readonly captureCheckpoint: (input: VcsCaptureCheckpointInput) => Effect.Effect<void, VcsError>;
  readonly hasCheckpointRef: (
    input: Omit<VcsRestoreCheckpointInput, "fallbackToHead">,
  ) => Effect.Effect<boolean, VcsError>;
  readonly restoreCheckpoint: (
    input: VcsRestoreCheckpointInput,
  ) => Effect.Effect<boolean, VcsError>;
  readonly diffCheckpoints: (input: VcsDiffCheckpointsInput) => Effect.Effect<string, VcsError>;
  readonly deleteCheckpointRefs: (
    input: VcsDeleteCheckpointRefsInput,
  ) => Effect.Effect<void, VcsError>;
}

/** Push is handled a layer up, where the driver's remote helpers live. */
export type VcsCommitInput = Omit<WorkingCopyCommitInput, "push">;

export interface VcsCommitResult {
  readonly commitSha: string;
  readonly branch: string | null;
}

/**
 * History and working-copy editing for the Source Control surface. Optional on
 * the driver: a VCS that does not implement it leaves the surface unavailable
 * rather than failing at call time.
 */
export interface VcsCommitGraphOps {
  readonly listCommits: (
    input: CommitGraphListInput,
  ) => Effect.Effect<CommitGraphListResult, VcsError>;
  readonly readCommitFiles: (
    input: CommitGraphCommitFilesInput,
  ) => Effect.Effect<CommitGraphCommitFilesResult, VcsError>;
  readonly readCommitPatch: (input: CommitPatchInput) => Effect.Effect<CommitPatchResult, VcsError>;
  readonly readWorkingCopy: (
    input: WorkingCopyStatusInput,
  ) => Effect.Effect<WorkingCopyStatusResult, VcsError>;
  readonly setStaged: (
    input: WorkingCopyStageInput,
  ) => Effect.Effect<WorkingCopyStageResult, VcsError>;
  readonly commit: (
    input: VcsCommitInput,
  ) => Effect.Effect<VcsCommitResult, VcsError | WorkingCopyCommitFailedError>;
}

export class VcsDriver extends Context.Service<
  VcsDriver,
  {
    readonly capabilities: VcsDriverCapabilities;
    readonly execute: (
      input: Omit<VcsProcess.VcsProcessInput, "command">,
    ) => Effect.Effect<VcsProcess.VcsProcessOutput, VcsError>;
    readonly checkpoints?: VcsCheckpointOps;
    readonly commitGraph?: VcsCommitGraphOps;
    readonly detectRepository: (
      cwd: string,
    ) => Effect.Effect<VcsRepositoryIdentity | null, VcsError>;
    readonly isInsideWorkTree: (cwd: string) => Effect.Effect<boolean, VcsError>;
    readonly listWorkspaceFiles: (
      cwd: string,
    ) => Effect.Effect<VcsListWorkspaceFilesResult, VcsError>;
    readonly listRemotes: (cwd: string) => Effect.Effect<VcsListRemotesResult, VcsError>;
    readonly filterIgnoredPaths: (
      cwd: string,
      relativePaths: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<string>, VcsError>;
    readonly initRepository: (input: VcsInitInput) => Effect.Effect<void, VcsError>;
    readonly getDiffPreview?: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, VcsError>;
  }
>()("t3/vcs/VcsDriver") {}
