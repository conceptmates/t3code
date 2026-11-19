import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { msg, useMessages } from "gt-react-native";

import { m, type MessageResolver } from "../i18n/messages";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("mobile-environment-query:empty"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly successResult: AsyncResult.Success<A, unknown> | null;
  readonly error: string | null;
  readonly failure: unknown;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly refresh: () => void;
}

/** What a request cut off by a dropped connection says; it carries no error of its own. */
export const ENVIRONMENT_REQUEST_INTERRUPTED = msg("The connection dropped before this finished.");

/** `Cause.pretty` renders an empty defect as "Unknown error", which tells the reader nothing. */
const UNINFORMATIVE_CAUSE = /^(error:\s*)?unknown error:?$/i;

function describeOpaqueCause(cause: Cause.Cause<unknown>): string | null {
  const detail = Cause.pretty(cause).split("\n")[0]?.trim().replace(/:$/, "");
  return detail && !UNINFORMATIVE_CAUSE.test(detail) ? detail : null;
}

export function formatEnvironmentQueryError(
  cause: Cause.Cause<unknown>,
  resolve: MessageResolver = m,
): string {
  if (Cause.hasInterruptsOnly(cause)) return resolve(ENVIRONMENT_REQUEST_INTERRUPTED);
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  // Every declared environment error carries a message, so landing here means a transport or
  // decode fault, most often an environment too old to know the method. Name it.
  const fallback = resolve(msg("The environment request failed."));
  const detail = describeOpaqueCause(cause);
  return detail ? `${fallback} (${detail})` : fallback;
}

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  const resolve = useMessages();
  return {
    data: AsyncResult.getOrElse(result, () => null),
    // Data may be structurally shared; only a settled success proves a new response.
    successResult: result._tag === "Success" && !result.waiting ? result : null,
    failure: result._tag === "Failure" ? Cause.squash(result.cause) : null,
    error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause, resolve) : null,
    isPending: atom !== null && result.waiting,
    isSuccess: result._tag === "Success",
    refresh,
  };
}
