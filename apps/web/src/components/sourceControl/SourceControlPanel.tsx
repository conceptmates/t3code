import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  CommitGraphCommit,
  CommitGraphFileChange,
  CommitGraphRef,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { COMMIT_GRAPH_DEFAULT_PAGE_SIZE, WorkingCopyCommitFailedError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MinusIcon,
  PlusIcon,
  SparklesIcon,
  TagIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { commitGraphEnvironment } from "~/state/commitGraph";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useTheme } from "~/hooks/useTheme";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CommitGraphLanes, GRAPH_ROW_HEIGHT, graphWidth } from "./CommitGraphLanes";
import { CommitPatchView } from "./CommitPatchView";
import { layoutCommitGraph } from "./commitGraphLayout";

interface SourceControlPanelProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly threadId: ThreadId | null;
  /** An agent is mid-turn in this thread; committing now is allowed but noted. */
  readonly isTurnActive: boolean;
}

const STATUS_LETTER: Record<CommitGraphFileChange["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  untracked: "U",
  conflicted: "!",
};

const STATUS_CLASS: Record<CommitGraphFileChange["status"], string> = {
  // VS Code gitDecoration palette: green for added, amber for modified,
  // red for deleted, blue for renamed/copied.
  added: "text-[#1a7f37] dark:text-[#7ee787]",
  modified: "text-[#9a6700] dark:text-[#e2c08d]",
  deleted: "text-[#cf222e] dark:text-[#ff7b72]",
  renamed: "text-[#0969da] dark:text-[#79c0ff]",
  copied: "text-[#0969da] dark:text-[#79c0ff]",
  "type-changed": "text-[#9a6700] dark:text-[#e2c08d]",
  untracked: "text-[#1a7f37] dark:text-[#7ee787]",
  conflicted: "text-destructive",
};

const isCommitFailure = Schema.is(WorkingCopyCommitFailedError);

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function directoryName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function RefChip({ commitRef }: { readonly commitRef: CommitGraphRef }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex max-w-40 items-center gap-1 truncate rounded-sm border px-1 text-[10px] leading-4",
              commitRef.isHead && "border-primary/50 text-primary",
              commitRef.kind === "remote" && "text-muted-foreground",
            )}
          />
        }
      >
        {commitRef.kind === "tag" && <TagIcon className="size-2.5 shrink-0" />}
        <span className="truncate">{commitRef.name}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{commitRef.name}</TooltipPopup>
    </Tooltip>
  );
}

function FileRow({
  file,
  action,
  onAction,
  onOpen,
  isOpen,
}: {
  readonly file: CommitGraphFileChange;
  readonly action: "stage" | "unstage" | null;
  readonly onAction?: () => void;
  readonly onOpen?: () => void;
  readonly isOpen?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 pr-2 pl-3",
        isOpen && "bg-accent/50",
        file.status === "deleted" && "opacity-90",
      )}
    >
      <button
        type="button"
        title={file.path}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
        onClick={onOpen}
        disabled={onOpen === undefined}
      >
        <PierreEntryIcon
          pathValue={file.path}
          kind="file"
          theme={resolvedTheme}
          className="size-4"
        />
        <span
          className={cn(
            "truncate text-sm",
            file.status === "deleted" && "line-through decoration-current/60",
          )}
        >
          {fileName(file.path)}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {directoryName(file.path)}
        </span>
      </button>
      {file.insertions !== null && file.insertions > 0 && (
        <span className="shrink-0 text-[#1a7f37] text-xs tabular-nums dark:text-[#7ee787]">
          +{file.insertions}
        </span>
      )}
      {file.deletions !== null && file.deletions > 0 && (
        <span className="shrink-0 text-[#cf222e] text-xs tabular-nums dark:text-[#ff7b72]">
          −{file.deletions}
        </span>
      )}
      {action !== null && (
        <Button
          size="icon-tiny"
          variant="ghost"
          aria-label={`${action === "stage" ? "Stage" : "Unstage"} ${file.path}`}
          onClick={onAction}
          className="shrink-0 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          {action === "stage" ? <PlusIcon /> : <MinusIcon />}
        </Button>
      )}
      <span
        title={file.status}
        className={cn(
          "w-4 shrink-0 text-center font-mono font-semibold text-xs",
          STATUS_CLASS[file.status],
        )}
      >
        {STATUS_LETTER[file.status]}
      </span>
    </div>
  );
}

function ChangesSection({
  title,
  files,
  action,
  onAction,
  onStageAll,
}: {
  readonly title: string;
  readonly files: ReadonlyArray<CommitGraphFileChange>;
  readonly action: "stage" | "unstage" | null;
  readonly onAction: (path: string) => void;
  readonly onStageAll?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (files.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          )}
          <span className="truncate font-medium text-xs uppercase tracking-wide">{title}</span>
          <span className="text-muted-foreground text-xs">{files.length}</span>
        </button>
        {onStageAll && (
          <Button
            size="icon-tiny"
            variant="ghost"
            aria-label={`${title}: all`}
            onClick={onStageAll}
          >
            {action === "stage" ? <PlusIcon /> : <MinusIcon />}
          </Button>
        )}
      </div>
      {!collapsed &&
        files.map((file) => (
          <FileRow
            key={`${title}:${file.path}`}
            file={file}
            action={action}
            onAction={() => onAction(file.path)}
          />
        ))}
    </section>
  );
}

/**
 * Source Control: the commit box, the working copy split into index and
 * worktree halves, and the repository's commit graph below them.
 */
export function SourceControlPanel({
  environmentId,
  cwd,
  threadId,
  isTurnActive,
}: SourceControlPanelProps) {
  const [message, setMessage] = useState("");
  const [limit, setLimit] = useState(COMMIT_GRAPH_DEFAULT_PAGE_SIZE);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [commitFailure, setCommitFailure] = useState<WorkingCopyCommitFailedError | null>(null);
  const [busy, setBusy] = useState(false);

  const commitsQuery = useEnvironmentQuery(
    commitGraphEnvironment.commits({ environmentId, input: { cwd, limit } }),
  );
  const workingCopyQuery = useEnvironmentQuery(
    commitGraphEnvironment.workingCopy({ environmentId, input: { cwd } }),
  );
  const filesQuery = useEnvironmentQuery(
    expandedSha === null
      ? null
      : commitGraphEnvironment.commitFiles({ environmentId, input: { cwd, sha: expandedSha } }),
  );
  const patchQuery = useEnvironmentQuery(
    expandedSha === null || openPath === null
      ? null
      : commitGraphEnvironment.commitPatch({
          environmentId,
          input: { cwd, sha: expandedSha, path: openPath },
        }),
  );
  // The server pushes status after every commit, stage, and agent checkpoint.
  const statusQuery = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }));

  const stage = useAtomCommand(commitGraphEnvironment.stage, "stage changes");
  const commit = useAtomCommand(commitGraphEnvironment.commit, { reportFailure: false });
  const suggestMessage = useAtomCommand(commitGraphEnvironment.suggestMessage, {
    reportFailure: false,
  });

  // Held in a ref so the status-driven effect below does not re-run whenever a
  // query's refresh identity changes, which would refetch on every render.
  const refreshRef = useRef({
    commits: commitsQuery.refresh,
    workingCopy: workingCopyQuery.refresh,
  });
  useEffect(() => {
    refreshRef.current = { commits: commitsQuery.refresh, workingCopy: workingCopyQuery.refresh };
  }, [commitsQuery.refresh, workingCopyQuery.refresh]);

  const refreshAll = useCallback(() => {
    refreshRef.current.commits();
    refreshRef.current.workingCopy();
  }, []);

  const status = statusQuery.data;
  // A cheap fingerprint of everything a commit or an agent turn would move.
  const statusSignal = status
    ? `${status.refName}:${status.workingTree.files.length}:${status.aheadCount}:${status.workingTree.insertions}:${status.workingTree.deletions}`
    : "";
  useEffect(() => {
    if (statusSignal.length > 0) {
      refreshAll();
    }
  }, [statusSignal, refreshAll]);

  const commits = commitsQuery.data?.commits ?? [];
  const layout = useMemo(() => layoutCommitGraph(commits), [commits]);
  const headSha = commitsQuery.data?.headSha ?? null;
  const workingCopy = workingCopyQuery.data;
  const staged = workingCopy?.staged ?? [];
  const unstaged = workingCopy?.unstaged ?? [];
  const conflicted = workingCopy?.conflicted ?? [];
  const hasChanges = staged.length + unstaged.length + conflicted.length > 0;
  const isRepo = commitsQuery.data?.isRepo ?? true;

  const setStaged = async (paths: ReadonlyArray<string>, next: boolean) => {
    if (paths.length === 0) return;
    await stage({ environmentId, input: { cwd, paths, staged: next } });
    refreshAll();
  };

  const runCommit = async (push: boolean) => {
    if (message.trim().length === 0 || busy) return;
    setBusy(true);
    setCommitFailure(null);
    const result = await commit({
      environmentId,
      input: {
        cwd,
        message,
        // VS Code's rule: commit the index, or everything tracked if it is empty.
        ...(staged.length === 0 ? { stageAll: true } : {}),
        ...(push ? { push: true } : {}),
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setCommitFailure(isCommitFailure(failure) ? failure : null);
      refreshAll();
      return;
    }
    setMessage("");
    refreshAll();
  };

  const generateMessage = async () => {
    setBusy(true);
    const result = await suggestMessage({
      environmentId,
      input: { cwd, ...(threadId === null ? {} : { threadId }) },
    });
    setBusy(false);
    if (result._tag === "Success") {
      setMessage(result.value.message);
    }
  };

  const toggleCommit = (sha: string) => {
    setOpenPath(null);
    setExpandedSha((current) => (current === sha ? null : sha));
  };

  if (!isRepo) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-center text-muted-foreground text-sm">
          This workspace isn&apos;t a Git repository.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium text-sm">Source Control</span>
          {commitsQuery.data?.branch && (
            <span className="truncate text-muted-foreground text-xs">
              {commitsQuery.data.branch}
            </span>
          )}
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="Refresh" onClick={refreshAll}>
          <RefreshIcon refreshing={commitsQuery.isPending || workingCopyQuery.isPending} />
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-b p-2">
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void runCommit(false);
            }
          }}
          placeholder={
            staged.length > 0
              ? "Message (⌘Enter to commit staged changes)"
              : "Message (⌘Enter to commit all changes)"
          }
          className="min-h-16 resize-none text-sm"
        />
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            disabled={busy || !hasChanges}
            onClick={() => void generateMessage()}
          >
            <SparklesIcon className="size-3.5" />
            Generate
          </Button>
          <div className="flex-1" />
          <Button
            size="xs"
            disabled={busy || message.trim().length === 0 || !hasChanges}
            onClick={() => void runCommit(false)}
          >
            Commit
          </Button>
          <Menu>
            <MenuTrigger
              render={<Button size="icon-xs" variant="outline" aria-label="Commit options" />}
            >
              <ChevronDownIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                disabled={busy || message.trim().length === 0 || !hasChanges}
                onClick={() => void runCommit(true)}
              >
                Commit &amp; Push
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
        {isTurnActive && (
          <p className="text-muted-foreground text-xs">
            An agent is working in this thread. Committing now includes whatever it has written so
            far.
          </p>
        )}
        {commitFailure && (
          <div className="rounded-sm border border-destructive/40 bg-destructive/5">
            <p className="px-2 py-1 text-destructive text-xs">
              {commitFailure.needsTerminal
                ? `Git needs a terminal to finish this ${commitFailure.step}. Run it from a terminal surface.`
                : `Git ${commitFailure.step} failed (exit ${commitFailure.exitCode}).`}
            </p>
            {commitFailure.output.trim().length > 0 && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap px-2 pb-2 font-mono text-xs">
                {commitFailure.output}
              </pre>
            )}
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {workingCopyQuery.error && (
          <p className="px-3 py-2 text-destructive text-xs">{workingCopyQuery.error}</p>
        )}
        <ChangesSection
          title="Merge conflicts"
          files={conflicted}
          action="stage"
          onAction={(path) => void setStaged([path], true)}
        />
        <ChangesSection
          title="Staged changes"
          files={staged}
          action="unstage"
          onAction={(path) => void setStaged([path], false)}
          onStageAll={() =>
            void setStaged(
              staged.map((file) => file.path),
              false,
            )
          }
        />
        <ChangesSection
          title="Changes"
          files={unstaged}
          action="stage"
          onAction={(path) => void setStaged([path], true)}
          onStageAll={() =>
            void setStaged(
              unstaged.map((file) => file.path),
              true,
            )
          }
        />

        <div className="mt-1 border-t px-2 py-1">
          <span className="font-medium text-xs uppercase tracking-wide">Graph</span>
        </div>
        {commitsQuery.error && (
          <p className="px-3 py-2 text-destructive text-xs">{commitsQuery.error}</p>
        )}
        {commits.length === 0 && !commitsQuery.isPending && (
          <p className="px-3 py-6 text-center text-muted-foreground text-sm">No commits yet.</p>
        )}

        <ul>
          {commits.map((entry, index) => {
            const row = layout.rows[index];
            const expanded = expandedSha === entry.sha;
            return (
              <li key={entry.sha}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 pr-2 text-left hover:bg-accent/40",
                    expanded && "bg-accent/50",
                  )}
                  style={{ height: GRAPH_ROW_HEIGHT }}
                  onClick={() => toggleCommit(entry.sha)}
                >
                  {row ? (
                    <CommitGraphLanes
                      row={row}
                      laneCount={layout.laneCount}
                      isHead={entry.sha === headSha}
                    />
                  ) : (
                    <span style={{ width: graphWidth(layout.laneCount) }} />
                  )}
                  <CommitSummary commit={entry} />
                </button>
                {expanded && (
                  <div className="border-y bg-muted/10">
                    {entry.body.length > 0 && (
                      <pre className="whitespace-pre-wrap px-3 py-2 text-muted-foreground text-xs">
                        {entry.body}
                      </pre>
                    )}
                    {filesQuery.error && (
                      <p className="px-3 py-2 text-destructive text-xs">{filesQuery.error}</p>
                    )}
                    {(filesQuery.data?.files ?? []).map((file) => (
                      <div key={file.path}>
                        <FileRow
                          file={file}
                          action={null}
                          isOpen={openPath === file.path}
                          onOpen={() =>
                            setOpenPath((current) => (current === file.path ? null : file.path))
                          }
                        />
                        {openPath === file.path && patchQuery.data && (
                          <CommitPatchView
                            patch={patchQuery.data.patch}
                            truncated={patchQuery.data.truncated}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {commitsQuery.data?.hasMore && (
          <div className="p-2">
            <Button
              size="xs"
              variant="outline"
              className="w-full"
              disabled={commitsQuery.isPending}
              onClick={() => setLimit((value) => value + COMMIT_GRAPH_DEFAULT_PAGE_SIZE)}
            >
              Load more
            </Button>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function CommitSummary({ commit }: { readonly commit: CommitGraphCommit }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {commit.refs.map((commitRef) => (
        <RefChip key={`${commitRef.kind}:${commitRef.name}`} commitRef={commitRef} />
      ))}
      <span className="truncate text-sm">{commit.subject}</span>
      <span className="ml-auto shrink-0 text-muted-foreground text-xs">{commit.authorName}</span>
      <span className="shrink-0 font-mono text-muted-foreground text-xs">{commit.shortSha}</span>
      <span className="shrink-0 text-muted-foreground text-xs">
        {formatRelativeTimeLabel(new Date(commit.authoredAt).toISOString())}
      </span>
    </span>
  );
}
