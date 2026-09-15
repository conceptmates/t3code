import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { resolveRemoteArchiveVersion } from "./DesktopSshRunnerVersion.ts";

const CHECKSUMS = [{ name: "SHA256SUMS" }];
const RELEASE_INDEX = [
  { tag_name: "v0.0.41-nightly.20260914.1707", assets: CHECKSUMS },
  { tag_name: "v0.0.40", assets: [{ name: "T3-Code-0.0.40-arm64.dmg" }] },
];

function makeHttpClientLayer(
  handler: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, never>,
) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => handler(request)),
  );
}

function respond(request: HttpClientRequest.HttpClientRequest, status: number, body?: unknown) {
  return Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" } }),
      }),
    ),
  );
}

describe("SSH remote archive version", () => {
  it.effect("keeps the app version when its release archive is published", () =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const version = yield* resolveRemoteArchiveVersion({ appVersion: "0.0.41" }).pipe(
        Effect.provide(
          makeHttpClientLayer((request) => {
            urls.push(request.url);
            return respond(request, 200);
          }),
        ),
      );

      assert.equal(version, "0.0.41");
      assert.deepEqual(urls, [
        "https://github.com/pingdotgg/t3code/releases/download/v0.0.41/SHA256SUMS",
      ]);
    }),
  );

  it.effect("substitutes the newest installable release for an unpublished version", () =>
    Effect.gen(function* () {
      const version = yield* resolveRemoteArchiveVersion({ appVersion: "0.0.40" }).pipe(
        Effect.provide(
          makeHttpClientLayer((request) =>
            request.method === "HEAD"
              ? respond(request, 404)
              : respond(request, 200, RELEASE_INDEX),
          ),
        ),
      );

      assert.equal(version, "0.0.41-nightly.20260914.1707");
    }),
  );

  it.effect("keeps the app version when the release index cannot be read", () =>
    Effect.gen(function* () {
      const version = yield* resolveRemoteArchiveVersion({ appVersion: "0.0.40" }).pipe(
        Effect.provide(makeHttpClientLayer((request) => respond(request, 500))),
      );

      assert.equal(version, "0.0.40");
    }),
  );

  it.effect("never searches the index when a mirror is configured", () =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const version = yield* resolveRemoteArchiveVersion({
        appVersion: "0.0.40",
        releaseBaseUrl: "https://mirror.example/t3",
      }).pipe(
        Effect.provide(
          makeHttpClientLayer((request) => {
            urls.push(request.url);
            return respond(request, 404);
          }),
        ),
      );

      assert.equal(version, "0.0.40");
      assert.deepEqual(urls, ["https://mirror.example/t3/v0.0.40/SHA256SUMS"]);
    }),
  );
});
