import type {
  CommitGraphCommit,
  CommitGraphFileChange,
  CommitGraphFileStatus,
  CommitGraphRef,
} from "@t3tools/contracts";

/**
 * Parsers for the Source Control surface's git output. Kept separate from the
 * driver so the field splitting, which is the part that actually breaks on
 * unusual commits, is testable without spawning git.
 */

/** Separates records. Cannot appear in a commit message git would round-trip. */
const RECORD_SEPARATOR = "\x1e";
/** Separates fields inside one record, so a multi-line body stays one field. */
const FIELD_SEPARATOR = "\x1f";

export const COMMIT_GRAPH_LOG_FORMAT = [
  `${RECORD_SEPARATOR}%H`,
  "%h",
  "%P",
  "%an",
  "%ae",
  "%at",
  "%s",
  "%b",
].join(FIELD_SEPARATOR);

export interface GitRefRecord {
  readonly objectName: string;
  /** Tag objects point at a commit through this; empty for direct refs. */
  readonly peeledObjectName: string;
  readonly refName: string;
}

export const COMMIT_GRAPH_REF_FORMAT = ["%(objectname)", "%(*objectname)", "%(refname)"].join(
  FIELD_SEPARATOR,
);

export function parseRefRecords(stdout: string): GitRefRecord[] {
  const records: GitRefRecord[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [objectName = "", peeledObjectName = "", refName = ""] = line.split(FIELD_SEPARATOR);
    if (refName.length === 0) {
      continue;
    }
    records.push({ objectName, peeledObjectName, refName });
  }
  return records;
}

/**
 * Maps commit sha to the refs that resolve to it. `headRefName` is the full
 * ref name HEAD points at, or null when HEAD is detached.
 */
export function buildRefIndex(
  records: ReadonlyArray<GitRefRecord>,
  headRefName: string | null,
): Map<string, CommitGraphRef[]> {
  const index = new Map<string, CommitGraphRef[]>();

  for (const record of records) {
    const ref = toCommitGraphRef(record.refName, headRefName);
    if (!ref) {
      continue;
    }
    // A tag object resolves to its commit through the peeled name.
    const sha = record.peeledObjectName.length > 0 ? record.peeledObjectName : record.objectName;
    if (sha.length === 0) {
      continue;
    }
    const existing = index.get(sha);
    if (existing) {
      existing.push(ref);
    } else {
      index.set(sha, [ref]);
    }
  }

  for (const refs of index.values()) {
    refs.sort(compareRefs);
  }

  return index;
}

function toCommitGraphRef(refName: string, headRefName: string | null): CommitGraphRef | null {
  const isHead = headRefName !== null && refName === headRefName;
  if (refName.startsWith("refs/heads/")) {
    return { name: refName.slice("refs/heads/".length), kind: "branch", isHead };
  }
  if (refName.startsWith("refs/remotes/")) {
    const name = refName.slice("refs/remotes/".length);
    // `origin/HEAD` is a symbolic pointer, not a branch anyone wants a chip for.
    if (name.endsWith("/HEAD")) {
      return null;
    }
    return { name, kind: "remote", isHead: false };
  }
  if (refName.startsWith("refs/tags/")) {
    return { name: refName.slice("refs/tags/".length), kind: "tag", isHead: false };
  }
  return null;
}

const REF_KIND_ORDER: Record<CommitGraphRef["kind"], number> = {
  head: 0,
  branch: 1,
  remote: 2,
  tag: 3,
};

function compareRefs(left: CommitGraphRef, right: CommitGraphRef): number {
  if (left.isHead !== right.isHead) {
    return left.isHead ? -1 : 1;
  }
  const kindDelta = REF_KIND_ORDER[left.kind] - REF_KIND_ORDER[right.kind];
  return kindDelta === 0 ? left.name.localeCompare(right.name) : kindDelta;
}

export function parseCommitGraphLog(
  stdout: string,
  refsBySha: ReadonlyMap<string, ReadonlyArray<CommitGraphRef>>,
  detachedHeadSha: string | null,
): CommitGraphCommit[] {
  const commits: CommitGraphCommit[] = [];

  for (const record of stdout.split(RECORD_SEPARATOR)) {
    if (record.trim().length === 0) {
      continue;
    }
    const fields = record.split(FIELD_SEPARATOR);
    const sha = fields[0]?.trim() ?? "";
    if (sha.length === 0) {
      continue;
    }
    const parentField = fields[2]?.trim() ?? "";
    const authoredSeconds = Number.parseInt(fields[5] ?? "", 10);
    const refs = [...(refsBySha.get(sha) ?? [])];
    if (detachedHeadSha !== null && sha === detachedHeadSha) {
      refs.unshift({ name: "HEAD", kind: "head", isHead: true });
    }

    commits.push({
      sha,
      shortSha: fields[1]?.trim() || sha.slice(0, 7),
      parents: parentField.length === 0 ? [] : parentField.split(" "),
      authorName: fields[3] ?? "",
      authorEmail: fields[4] ?? "",
      authoredAt: Number.isFinite(authoredSeconds) ? authoredSeconds * 1000 : 0,
      subject: fields[6] ?? "",
      // Trailing newlines from `%b` are noise in a detail pane.
      body: (fields[7] ?? "").replace(/\s+$/, ""),
      refs,
    });
  }

  return commits;
}

/** Splits `-z` output, which terminates every field with NUL. */
function splitNulFields(stdout: string): string[] {
  const fields = stdout.split("\0");
  if (fields.length > 0 && fields[fields.length - 1] === "") {
    fields.pop();
  }
  return fields;
}

function statusFromCode(code: string): CommitGraphFileStatus {
  switch (code[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "conflicted";
    default:
      return "modified";
  }
}

export interface ParsedNumstatEntry {
  readonly path: string;
  readonly oldPath: string | null;
  readonly insertions: number | null;
  readonly deletions: number | null;
  readonly binary: boolean;
}

/**
 * `git diff-tree --numstat -z` emits `ins\tdel\tpath\0`, except for renames and
 * copies where the path is empty and the two paths follow as separate fields.
 * Binary files report `-` for both counts.
 */
export function parseNumstat(stdout: string): ParsedNumstatEntry[] {
  const fields = splitNulFields(stdout);
  const entries: ParsedNumstatEntry[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === undefined || field.length === 0) {
      continue;
    }
    const parts = field.split("\t");
    if (parts.length < 2) {
      continue;
    }
    const [insertionsRaw = "", deletionsRaw = "", inlinePath = ""] = parts;
    const binary = insertionsRaw === "-" || deletionsRaw === "-";

    let path = inlinePath;
    let oldPath: string | null = null;
    if (path.length === 0) {
      oldPath = fields[index + 1] ?? null;
      path = fields[index + 2] ?? "";
      index += 2;
    }
    if (path.length === 0) {
      continue;
    }

    entries.push({
      path,
      oldPath,
      insertions: binary ? null : toCount(insertionsRaw),
      deletions: binary ? null : toCount(deletionsRaw),
      binary,
    });
  }

  return entries;
}

function toCount(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * `git diff-tree --name-status -z` emits `STATUS\0path\0`, with renames and
 * copies emitting `R100\0oldPath\0newPath\0`.
 */
export function parseNameStatus(stdout: string): Map<string, CommitGraphFileStatus> {
  const fields = splitNulFields(stdout);
  const statuses = new Map<string, CommitGraphFileStatus>();

  for (let index = 0; index < fields.length; index += 1) {
    const code = fields[index];
    if (code === undefined || code.length === 0) {
      continue;
    }
    const status = statusFromCode(code);
    if (status === "renamed" || status === "copied") {
      const newPath = fields[index + 2];
      if (newPath) {
        statuses.set(newPath, status);
      }
      index += 2;
      continue;
    }
    const path = fields[index + 1];
    if (path) {
      statuses.set(path, status);
    }
    index += 1;
  }

  return statuses;
}

export function mergeCommitFiles(
  numstat: ReadonlyArray<ParsedNumstatEntry>,
  statuses: ReadonlyMap<string, CommitGraphFileStatus>,
): CommitGraphFileChange[] {
  return numstat.map((entry) => ({
    path: entry.path,
    oldPath: entry.oldPath,
    status: statuses.get(entry.path) ?? (entry.oldPath === null ? "modified" : "renamed"),
    insertions: entry.insertions,
    deletions: entry.deletions,
    binary: entry.binary,
  }));
}

export interface ParsedWorkingCopy {
  readonly branch: string | null;
  readonly isUnborn: boolean;
  readonly staged: CommitGraphFileChange[];
  readonly unstaged: CommitGraphFileChange[];
  readonly conflicted: CommitGraphFileChange[];
}

function workingCopyFile(
  path: string,
  oldPath: string | null,
  status: CommitGraphFileStatus,
): CommitGraphFileChange {
  // Line counts would cost a diff per file; the panel shows status letters.
  return { path, oldPath, status, insertions: null, deletions: null, binary: false };
}

/**
 * Parses `git status --porcelain=v2 -z --branch --untracked-files=all`.
 *
 * A path lands in both `staged` and `unstaged` when the index and the working
 * tree disagree, which is what VS Code renders as two separate rows.
 */
export function parseWorkingCopyStatus(stdout: string): ParsedWorkingCopy {
  const fields = splitNulFields(stdout);
  let branch: string | null = null;
  let isUnborn = false;
  const staged: CommitGraphFileChange[] = [];
  const unstaged: CommitGraphFileChange[] = [];
  const conflicted: CommitGraphFileChange[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === undefined || field.length === 0) {
      continue;
    }

    if (field.startsWith("# branch.head ")) {
      const value = field.slice("# branch.head ".length).trim();
      branch = value === "(detached)" ? null : value;
      continue;
    }
    if (field.startsWith("# branch.oid ")) {
      isUnborn = field.slice("# branch.oid ".length).trim() === "(initial)";
      continue;
    }
    if (field.startsWith("# ")) {
      continue;
    }

    const kind = field[0];
    if (kind === "?") {
      const path = field.slice(2);
      if (path.length > 0) {
        unstaged.push(workingCopyFile(path, null, "untracked"));
      }
      continue;
    }
    if (kind === "!") {
      continue;
    }
    if (kind === "u") {
      const path = unmergedPath(field);
      if (path) {
        conflicted.push(workingCopyFile(path, null, "conflicted"));
      }
      continue;
    }
    if (kind !== "1" && kind !== "2") {
      continue;
    }

    const parts = field.split(" ");
    const xy = parts[1] ?? "..";
    const indexStatus = xy[0] ?? ".";
    const worktreeStatus = xy[1] ?? ".";

    let path: string;
    let oldPath: string | null = null;
    if (kind === "2") {
      // `2 XY ... <score> <path>` with the original path in the next field.
      path = parts.slice(9).join(" ");
      oldPath = fields[index + 1] ?? null;
      index += 1;
    } else {
      path = parts.slice(8).join(" ");
    }
    if (path.length === 0) {
      continue;
    }

    if (indexStatus !== ".") {
      staged.push(workingCopyFile(path, oldPath, statusFromCode(indexStatus)));
    }
    if (worktreeStatus !== ".") {
      // The worktree half of a rename is a plain edit of the new path.
      unstaged.push(workingCopyFile(path, null, statusFromCode(worktreeStatus)));
    }
  }

  return { branch, isUnborn, staged, unstaged, conflicted };
}

function unmergedPath(field: string): string | null {
  const parts = field.split(" ");
  const path = parts.slice(10).join(" ");
  return path.length > 0 ? path : null;
}

/**
 * Git blocks on a terminal for credentials and for a GPG passphrase. The panel
 * cannot answer either, so it tells the user to finish in a terminal instead.
 */
export function outputNeedsTerminal(output: string): boolean {
  return (
    /gpg failed to sign/i.test(output) ||
    /could not read (Username|Password)/i.test(output) ||
    /terminal prompts disabled/i.test(output) ||
    /Authentication failed/i.test(output)
  );
}
