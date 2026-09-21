import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import {
  HostProcessEnvironment,
  HostProcessExecutablePath,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { describe, expect, it } from "vite-plus/test";

import {
  normalizeOpenCodeInventoryV2,
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  OpenCodeRuntimeLive,
  parseServerUrlFromOutput,
  resolveOpenCodeConfigContent,
  resolveOpenCodeServerPassword,
  resolveOpenCodeServerStartupTimeoutMs,
  verifyOpenCodeServerVersion,
} from "./opencodeRuntime.ts";

describe("resolveOpenCodeConfigContent", () => {
  it("prefers the caller environment over the inherited environment", () => {
    expect(
      resolveOpenCodeConfigContent(
        { OPENCODE_CONFIG_CONTENT: '{"source":"caller"}' },
        { OPENCODE_CONFIG_CONTENT: '{"source":"process"}' },
      ),
    ).toBe('{"source":"caller"}');
  });

  it("falls back to the inherited environment and then an empty config", () => {
    expect(
      resolveOpenCodeConfigContent(undefined, {
        OPENCODE_CONFIG_CONTENT: '{"source":"process"}',
      }),
    ).toBe('{"source":"process"}');
    expect(resolveOpenCodeConfigContent(undefined, {})).toBe("{}");
  });
});

describe("resolveOpenCodeServerPassword", () => {
  it("uses the local environment password when settings do not provide one", () => {
    expect(
      resolveOpenCodeServerPassword(
        { external: false, environment: { OPENCODE_SERVER_PASSWORD: " env password " } },
        {},
      ),
    ).toBe(" env password ");
  });

  it("uses the settings password for a local server", () => {
    expect(
      resolveOpenCodeServerPassword({ external: false, serverPassword: " settings password " }, {}),
    ).toBe(" settings password ");
  });

  it("uses the settings password when local settings and environment differ", () => {
    expect(
      resolveOpenCodeServerPassword(
        {
          external: false,
          serverPassword: "settings-password",
          environment: { OPENCODE_SERVER_PASSWORD: "environment-password" },
        },
        {},
      ),
    ).toBe("settings-password");
  });

  it("does not send an inherited local password to an external server", () => {
    expect(
      resolveOpenCodeServerPassword(
        { external: true, environment: { OPENCODE_SERVER_PASSWORD: "local-secret" } },
        { OPENCODE_SERVER_PASSWORD: "inherited-secret" },
      ),
    ).toBeUndefined();
  });
});

describe("resolveOpenCodeServerStartupTimeoutMs", () => {
  it("defaults to 30s for blank or invalid input", () => {
    expect(resolveOpenCodeServerStartupTimeoutMs("")).toBe(30_000);
    expect(resolveOpenCodeServerStartupTimeoutMs(undefined)).toBe(30_000);
    expect(resolveOpenCodeServerStartupTimeoutMs("abc")).toBe(30_000);
  });

  it("converts seconds to milliseconds and clamps to 10-120s", () => {
    expect(resolveOpenCodeServerStartupTimeoutMs("60")).toBe(60_000);
    expect(resolveOpenCodeServerStartupTimeoutMs("5")).toBe(10_000);
    expect(resolveOpenCodeServerStartupTimeoutMs("300")).toBe(120_000);
  });
});

describe("parseServerUrlFromOutput", () => {
  it("parses the v1 startup line", () => {
    expect(parseServerUrlFromOutput("opencode server listening on http://127.0.0.1:4096\n")).toBe(
      "http://127.0.0.1:4096",
    );
  });

  it("parses the v2 startup line", () => {
    expect(parseServerUrlFromOutput("server listening on http://127.0.0.1:4096\n")).toBe(
      "http://127.0.0.1:4096",
    );
  });

  it("returns null when no ready line was printed", () => {
    expect(parseServerUrlFromOutput("server password abc123\n")).toBeNull();
  });
});

describe("normalizeOpenCodeInventoryV2", () => {
  it("regroups flat v2 lists into the shared inventory shape", () => {
    const inventory = normalizeOpenCodeInventoryV2({
      providers: [
        { id: "anthropic", name: "Anthropic" },
        { id: "disabled-p", name: "Disabled", disabled: true },
      ],
      models: [
        {
          id: "claude-sonnet-4-5",
          providerID: "anthropic",
          name: "Claude Sonnet 4.5",
          variants: [{ id: "high" }, { id: "medium" }],
        },
        { id: "orphan", providerID: "unknown", name: "Orphan" },
        { id: "noname", providerID: "anthropic", name: "  " },
        { id: "disabled-model", providerID: "disabled-p", name: "Disabled Model" },
      ],
      agents: [
        { id: "build", name: "Build", mode: "primary", hidden: false },
        { id: "plan", mode: "all", hidden: true },
      ],
      skills: [{ name: "review", description: "Review code", location: "/skills/review.md" }],
    });

    expect(inventory.providerList.connected).toEqual(["anthropic"]);
    expect(inventory.providerList.all.map((provider) => provider.id)).toEqual(["anthropic"]);
    const models = inventory.providerList.all[0]!.models;
    expect(Object.keys(models)).toEqual(["claude-sonnet-4-5"]);
    expect(models["claude-sonnet-4-5"]).toEqual({
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      variants: { high: {}, medium: {} },
    });
    expect(inventory.agents).toEqual([
      { name: "Build", mode: "primary", hidden: false },
      { name: "plan", mode: "all", hidden: true },
    ]);
    expect(inventory.skills).toEqual([
      { name: "review", description: "Review code", location: "/skills/review.md" },
    ]);
  });
});

function makeHealthClient(
  result: (options?: { readonly signal?: AbortSignal }) => Promise<unknown>,
): OpencodeClient {
  return {
    global: {
      health: result,
    },
  } as unknown as OpencodeClient;
}

describe("verifyOpenCodeServerVersion", () => {
  effectIt.effect("accepts a supported server version", () =>
    Effect.gen(function* () {
      const version = yield* verifyOpenCodeServerVersion(
        makeHealthClient(() => Promise.resolve({ data: { healthy: true, version: "1.14.19" } })),
      );
      expect(version).toBe("1.14.19");
    }),
  );

  effectIt.effect("rejects a server below the supported version", () =>
    Effect.gen(function* () {
      const error = yield* verifyOpenCodeServerVersion(
        makeHealthClient(() => Promise.resolve({ data: { healthy: true, version: "1.14.18" } })),
      ).pipe(Effect.flip);
      expect(error).toBeInstanceOf(OpenCodeRuntimeError);
      expect(error.detail).toContain("v1.14.18 is too old");
    }),
  );

  for (const data of [
    { healthy: true },
    { healthy: true, version: "not-a-version" },
    { healthy: false, version: "1.14.19" },
  ]) {
    effectIt.effect(`rejects an invalid health response: ${JSON.stringify(data)}`, () =>
      Effect.gen(function* () {
        const error = yield* verifyOpenCodeServerVersion(
          makeHealthClient(() => Promise.resolve({ data })),
        ).pipe(Effect.flip);
        expect(error).toBeInstanceOf(OpenCodeRuntimeError);
        expect(error.detail).toContain("requires OpenCode v1.14.19 or newer");
      }),
    );
  }

  effectIt.effect("preserves an unauthorized health error", () =>
    Effect.gen(function* () {
      const error = yield* verifyOpenCodeServerVersion(
        makeHealthClient(() =>
          Promise.reject({ response: { status: 401 }, error: { message: "Unauthorized" } }),
        ),
      ).pipe(Effect.flip);
      expect(error).toBeInstanceOf(OpenCodeRuntimeError);
      expect(error.detail).toContain("status=401");
      expect(error.detail).toContain("Unauthorized");
    }),
  );

  effectIt.effect("aborts a health request when the version check times out", () =>
    Effect.gen(function* () {
      let requestSignal: AbortSignal | undefined;
      const checkFiber = yield* verifyOpenCodeServerVersion(
        makeHealthClient((options) => {
          requestSignal = options?.signal;
          return new Promise(() => undefined);
        }),
      ).pipe(Effect.flip, Effect.forkChild);

      yield* Effect.yieldNow;
      expect(requestSignal).toBeDefined();
      yield* TestClock.adjust("6 seconds");

      const error = yield* Fiber.join(checkFiber);
      expect(error.detail).toBe("Timed out while checking the OpenCode server version.");
      expect(requestSignal?.aborted).toBe(true);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

describe("OpenCode server output", () => {
  effectIt.live(
    "drains stdout and stderr after startup so server requests can finish",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const environment = yield* HostProcessEnvironment;
        const executablePath = yield* HostProcessExecutablePath;
        const platform = yield* HostProcessPlatform;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-output-" });
        const isWindows = platform === "win32";
        const binaryPath = path.join(tempDir, isWindows ? "opencode.cmd" : "opencode");
        const scriptPath = path.join(tempDir, "opencode.mjs");

        yield* fs.writeFileString(
          scriptPath,
          `import { createServer } from "node:http";
const writeOutput = (stream) => new Promise((resolve, reject) => {
  stream.write("x".repeat(2 * 1024 * 1024), (error) => error ? reject(error) : resolve());
});
const server = createServer(async (request, response) => {
  if (request.url.startsWith("/api/location")) {
    response.statusCode = 404;
    response.end();
    return;
  }
  if (request.url.startsWith("/global/health")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ healthy: true, version: "1.14.19" }));
    return;
  }
  await Promise.all([writeOutput(process.stdout), writeOutput(process.stderr)]);
  response.end("drained");
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("opencode server listening on http://127.0.0.1:" + server.address().port + "\\n");
});
`,
        );
        yield* fs.writeFileString(
          binaryPath,
          [
            ...(isWindows ? ["@echo off"] : ["#!/bin/sh"]),
            isWindows
              ? '"%T3_TEST_NODE_BINARY%" "%T3_TEST_OPENCODE_SCRIPT%" %*'
              : 'exec "$T3_TEST_NODE_BINARY" "$T3_TEST_OPENCODE_SCRIPT" "$@"',
            "",
          ].join("\n"),
        );
        if (!isWindows) {
          yield* fs.chmod(binaryPath, 0o755);
        }

        const runtime = yield* OpenCodeRuntime;
        const server = yield* runtime.startOpenCodeServerProcess({
          binaryPath,
          directory: tempDir,
          port: 0,
          environment: {
            ...environment,
            T3_TEST_NODE_BINARY: executablePath,
            T3_TEST_OPENCODE_SCRIPT: scriptPath,
          },
        });
        const response = yield* HttpClient.get(`${server.url}/output`);

        expect(yield* response.text).toBe("drained");
        expect(yield* server.isRunning).toBe(true);
        expect(server.apiVersion).toBe("v1");
      }).pipe(
        Effect.scoped,
        Effect.provide([
          OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer)),
          FetchHttpClient.layer,
        ]),
      ),
    10_000,
  );

  effectIt.live(
    "spawns v2-style servers with an ephemeral password when none is configured",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const environment = yield* HostProcessEnvironment;
        const executablePath = yield* HostProcessExecutablePath;
        const platform = yield* HostProcessPlatform;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-password-" });
        const isWindows = platform === "win32";
        const binaryPath = path.join(tempDir, isWindows ? "opencode.cmd" : "opencode");
        const scriptPath = path.join(tempDir, "opencode.mjs");

        yield* fs.writeFileString(
          scriptPath,
          `import { createServer } from "node:http";
if (process.argv.includes("--version")) {
  process.stdout.write("opencode v2.0.5\\n");
  process.exit(0);
}
const server = createServer(async (request, response) => {
  if (request.url.startsWith("/api/location")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ directory: "ok" }));
    return;
  }
  if (request.url.startsWith("/global/health")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ healthy: true, version: "2.0.5" }));
    return;
  }
  if (request.url.startsWith("/env")) {
    response.end(process.env.OPENCODE_SERVER_PASSWORD ?? "");
    return;
  }
  response.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("server listening on http://127.0.0.1:" + server.address().port + "\\n");
});
`,
        );
        yield* fs.writeFileString(
          binaryPath,
          [
            ...(isWindows ? ["@echo off"] : ["#!/bin/sh"]),
            isWindows
              ? '"%T3_TEST_NODE_BINARY%" "%T3_TEST_OPENCODE_SCRIPT%" %*'
              : 'exec "$T3_TEST_NODE_BINARY" "$T3_TEST_OPENCODE_SCRIPT" "$@"',
            "",
          ].join("\n"),
        );
        if (!isWindows) {
          yield* fs.chmod(binaryPath, 0o755);
        }

        const runtime = yield* OpenCodeRuntime;
        const server = yield* runtime.startOpenCodeServerProcess({
          binaryPath,
          directory: tempDir,
          port: 0,
          environment: {
            ...environment,
            T3_TEST_NODE_BINARY: executablePath,
            T3_TEST_OPENCODE_SCRIPT: scriptPath,
          },
        });
        expect(server.serverPassword).toMatch(/^[0-9a-f]{64}$/);
        const response = yield* HttpClient.get(`${server.url}/env`);
        expect(yield* response.text).toBe(server.serverPassword);
      }).pipe(
        Effect.scoped,
        Effect.provide([
          OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer)),
          FetchHttpClient.layer,
        ]),
      ),
    10_000,
  );

  effectIt.live(
    "prefers a configured password over the ephemeral one",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const environment = yield* HostProcessEnvironment;
        const executablePath = yield* HostProcessExecutablePath;
        const platform = yield* HostProcessPlatform;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-password-" });
        const isWindows = platform === "win32";
        const binaryPath = path.join(tempDir, isWindows ? "opencode.cmd" : "opencode");
        const scriptPath = path.join(tempDir, "opencode.mjs");

        yield* fs.writeFileString(
          scriptPath,
          `import { createServer } from "node:http";
if (process.argv.includes("--version")) {
  process.stdout.write("opencode v2.0.5\\n");
  process.exit(0);
}
const server = createServer(async (request, response) => {
  if (request.url.startsWith("/api/location")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ directory: "ok" }));
    return;
  }
  if (request.url.startsWith("/global/health")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ healthy: true, version: "2.0.5" }));
    return;
  }
  if (request.url.startsWith("/env")) {
    response.end(process.env.OPENCODE_SERVER_PASSWORD ?? "");
    return;
  }
  response.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("server listening on http://127.0.0.1:" + server.address().port + "\\n");
});
`,
        );
        yield* fs.writeFileString(
          binaryPath,
          [
            ...(isWindows ? ["@echo off"] : ["#!/bin/sh"]),
            isWindows
              ? '"%T3_TEST_NODE_BINARY%" "%T3_TEST_OPENCODE_SCRIPT%" %*'
              : 'exec "$T3_TEST_NODE_BINARY" "$T3_TEST_OPENCODE_SCRIPT" "$@"',
            "",
          ].join("\n"),
        );
        if (!isWindows) {
          yield* fs.chmod(binaryPath, 0o755);
        }

        const runtime = yield* OpenCodeRuntime;
        const server = yield* runtime.startOpenCodeServerProcess({
          binaryPath,
          directory: tempDir,
          port: 0,
          serverPassword: "configured-secret",
          environment: {
            ...environment,
            T3_TEST_NODE_BINARY: executablePath,
            T3_TEST_OPENCODE_SCRIPT: scriptPath,
          },
        });
        expect(server.serverPassword).toBe("configured-secret");
        const response = yield* HttpClient.get(`${server.url}/env`);
        expect(yield* response.text).toBe("configured-secret");
      }).pipe(
        Effect.scoped,
        Effect.provide([
          OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer)),
          FetchHttpClient.layer,
        ]),
      ),
    10_000,
  );

  effectIt.live(
    "detects v2 servers via the API fallback and versions them from the CLI",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const environment = yield* HostProcessEnvironment;
        const executablePath = yield* HostProcessExecutablePath;
        const platform = yield* HostProcessPlatform;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-v2-" });
        const isWindows = platform === "win32";
        const binaryPath = path.join(tempDir, isWindows ? "opencode.cmd" : "opencode");
        const scriptPath = path.join(tempDir, "opencode.mjs");

        yield* fs.writeFileString(
          scriptPath,
          `import { createServer } from "node:http";
if (process.argv.includes("--version")) {
  process.stdout.write("opencode v2.0.5\\n");
  process.exit(0);
}
const server = createServer(async (request, response) => {
  if (request.url.startsWith("/api/location")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ directory: "${tempDir}" }));
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html>");
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("server listening on http://127.0.0.1:" + server.address().port + "\\n");
});
`,
        );
        yield* fs.writeFileString(
          binaryPath,
          [
            ...(isWindows ? ["@echo off"] : ["#!/bin/sh"]),
            isWindows
              ? '"%T3_TEST_NODE_BINARY%" "%T3_TEST_OPENCODE_SCRIPT%" %*'
              : 'exec "$T3_TEST_NODE_BINARY" "$T3_TEST_OPENCODE_SCRIPT" "$@"',
            "",
          ].join("\n"),
        );
        if (!isWindows) {
          yield* fs.chmod(binaryPath, 0o755);
        }

        const runtime = yield* OpenCodeRuntime;
        const server = yield* runtime.startOpenCodeServerProcess({
          binaryPath,
          directory: tempDir,
          port: 0,
          environment: {
            ...environment,
            T3_TEST_NODE_BINARY: executablePath,
            T3_TEST_OPENCODE_SCRIPT: scriptPath,
          },
        });
        expect(server.apiVersion).toBe("v2");
        expect(server.version).toBe("2.0.5");
        expect(yield* server.isRunning).toBe(true);
      }).pipe(
        Effect.scoped,
        Effect.provide([
          OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer)),
          FetchHttpClient.layer,
        ]),
      ),
    15_000,
  );
});
