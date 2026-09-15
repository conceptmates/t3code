/**
 * Which t3 release an SSH remote installs. Normally the app's own version, so
 * both sides run the same code. A desktop build compiled locally carries a
 * version nobody published, and its release either does not exist or only ever
 * carried desktop installers; the newest installable release stands in so the
 * remote has something to download.
 */
import {
  CLI_RELEASE_CHECKSUMS_FILE,
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
  newestInstallableCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

const ReleaseIndex = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.optional(Schema.Boolean),
    assets: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
  }),
);
const decodeReleaseIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(ReleaseIndex));

const REQUEST_TIMEOUT = Duration.seconds(15);
// The newest stable release sits a page or two behind a busy nightly train.
const RELEASE_INDEX_MAX_PAGES = 3;

/**
 * Resolves to the app's own version whenever that version is installable, and
 * never fails: a lookup that cannot answer leaves the app version in place, so
 * the remote reports the missing release itself.
 */
export const resolveRemoteArchiveVersion = Effect.fn("desktop.ssh.resolve_archive_version")(
  function* (input: {
    readonly appVersion: string;
    readonly releaseBaseUrl?: string | null;
  }): Effect.fn.Return<string, never, HttpClient.HttpClient> {
    const httpClient = yield* HttpClient.HttpClient;
    const releaseBaseUrl = input.releaseBaseUrl?.trim() || undefined;
    const checksumsUrl = `${cliReleaseDownloadBaseUrl(input.appVersion, releaseBaseUrl)}/${CLI_RELEASE_CHECKSUMS_FILE}`;
    const appVersionIsInstallable = yield* httpClient
      .execute(HttpClientRequest.head(checksumsUrl))
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    if (appVersionIsInstallable) return input.appVersion;
    // A mirror holds whatever its owner put there, so GitHub's index cannot
    // name a stand-in that the mirror is guaranteed to serve.
    if (releaseBaseUrl !== undefined) return input.appVersion;

    const releases: Array<{
      readonly tag_name: string;
      readonly draft?: boolean | undefined;
      readonly assets?: ReadonlyArray<{ readonly name: string }> | undefined;
    }> = [];
    for (let page = 1; page <= RELEASE_INDEX_MAX_PAGES; page += 1) {
      const body = yield* httpClient
        .execute(
          HttpClientRequest.get(cliReleaseIndexPageUrl(page)).pipe(
            HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.text),
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.orElseSucceed(() => ""),
        );
      const page_releases = yield* decodeReleaseIndex(body).pipe(Effect.orElseSucceed(() => []));
      if (page_releases.length === 0) break;
      releases.push(...page_releases);
      if (newestInstallableCliReleaseVersion(releases) !== undefined) break;
    }

    const substitute = newestInstallableCliReleaseVersion(releases);
    if (substitute === undefined) return input.appVersion;
    yield* Effect.logWarning("ssh.runner.version.substituted", {
      appVersion: input.appVersion,
      archiveVersion: substitute,
    });
    return substitute;
  },
);
