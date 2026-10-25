You are running unattended (no human is watching) inside a dedicated git worktree of the
conceptmates fork of T3 Code. Your job: finish merging `upstream/main` (pingdotgg/t3code)
into HEAD so the fork keeps all of its own features and the merged code typechecks.

Current state: {{STATE}}

Read these first:

- `AGENTS.md` in this worktree (repo rules).
- {{NOTES}} (patterns from earlier syncs: where upstream moves code,
  which fork features need re-inserting, which test deletions to accept).

Rules:

- Work only inside this worktree. Do not touch `~/.t3`, the main checkout at
  `/Users/cn/Developer/Git clone/t3code`, or `/Applications`.
- Never kill processes, start dev servers, push, build the desktop app, or open browsers.
- Keep fork features. When upstream deleted or moved the code a fork change lived in,
  port the fork change to the new location instead of dropping it. When upstream deleted
  low-signal tests, accept the deletion.
- `pnpm-lock.yaml`: take upstream's version, then run `vp i` and keep its result.
- Use `vp`, `node`, and `tsc` from `node_modules/.bin` (already on PATH).

Done means all of these hold:

1. No unmerged paths and no `<<<<<<< HEAD` / `>>>>>>> upstream/main` markers left.
2. `tsc --noEmit -p .` exits 0 in each of: apps/web, apps/desktop, apps/server, apps/mobile,
   packages/shared, packages/client-runtime, packages/contracts, packages/ssh.
3. `vp test run <file>` passes for test files beside the files you changed.
4. Everything is committed. If the merge is still in progress, commit it with this message:

   Merge upstream/main into main

   Co-Authored-By: Claude <noreply@anthropic.com>

   If the merge commit already exists, add your fixes as a follow-up commit
   `fix: repair fork after upstream sync`.

If you learn a new conflict pattern a future sync would trip on, append one short bullet
to {{NOTES}}.

Finish with exactly one final line: `SYNC_OK`, or `SYNC_FAILED: <one-line reason>` if you
cannot reach "done". Do not claim SYNC_OK unless you ran the checks above.
