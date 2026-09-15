import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("web-environment-query:empty"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly refresh: () => void;
}

/** `Cause.pretty` renders an empty defect as "Unknown error", which tells the reader nothing. */
const UNINFORMATIVE_CAUSE = /^(error:\s*)?unknown error:?$/i;

function describeOpaqueCause(cause: Cause.Cause<unknown>): string | null {
  const detail = Cause.pretty(cause).split("\n")[0]?.trim().replace(/:$/, "");
  return detail && !UNINFORMATIVE_CAUSE.test(detail) ? detail : null;
}

export function formatEnvironmentQueryError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  // Every declared environment error carries a message, so landing here means the
  // failure came from outside the RPC's error channel — a transport or decode
  // fault, most often an environment too old to know the method. Name it, rather
  // than leaving the reader with a string they cannot act on.
  const detail = describeOpaqueCause(cause);
  return detail ? `The environment request failed: ${detail}` : "The environment request failed.";
}

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
    isPending: atom !== null && result.waiting,
    isSuccess: result._tag === "Success",
    refresh,
  };
}
