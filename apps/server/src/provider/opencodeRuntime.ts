import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";

import type { ChatAttachment, ProviderApprovalDecision, RuntimeMode } from "@t3tools/contracts";
import {
  createOpencodeClient,
  type Agent,
  type Command,
  type FilePartInput,
  type Model,
  type OpencodeClient,
  type PermissionRuleset,
  type ProviderListResponse,
  type QuestionAnswer,
  type QuestionRequest,
} from "@opencode-ai/sdk/v2";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { isWindowsCommandNotFound } from "../processRunner.ts";
import { collectStreamAsString, parseGenericCliVersion } from "./providerSnapshot.ts";
import * as NetService from "@t3tools/shared/Net";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Unknown));
const OPENCODE_EMPTY_CONFIG_CONTENT = "{}";

export const MINIMUM_OPENCODE_VERSION = "1.14.19";
const OPENCODE_HEALTH_TIMEOUT = "5 seconds";
const OPENCODE_V2_PROBE_TIMEOUT = "2 seconds";

const OpenCodeHealthSchema = Schema.Struct({
  healthy: Schema.Literal(true),
  version: Schema.String,
});
const decodeOpenCodeHealth = Schema.decodeUnknownEffect(OpenCodeHealthSchema);

export function resolveOpenCodeConfigContent(
  inputEnvironment: Readonly<Record<string, string | undefined>> | undefined,
  inheritedEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (
    inputEnvironment?.OPENCODE_CONFIG_CONTENT ??
    inheritedEnvironment.OPENCODE_CONFIG_CONTENT ??
    OPENCODE_EMPTY_CONFIG_CONTENT
  );
}

export function resolveOpenCodeServerPassword(
  input: {
    readonly external: boolean;
    readonly serverPassword?: string;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  },
  inheritedEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (input.serverPassword !== undefined) {
    return input.serverPassword;
  }
  if (input.external) {
    return undefined;
  }
  return input.environment === undefined
    ? inheritedEnvironment.OPENCODE_SERVER_PASSWORD
    : input.environment.OPENCODE_SERVER_PASSWORD;
}

const DEFAULT_OPENCODE_SERVER_TIMEOUT_MS = 30_000;

/** Parse the OpenCode `serverStartupTimeoutSeconds` setting (seconds as text). */
export function resolveOpenCodeServerStartupTimeoutMs(value: string | null | undefined): number {
  const seconds = Number.parseInt((value ?? "").trim(), 10);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_OPENCODE_SERVER_TIMEOUT_MS;
  }
  const clampedSeconds = Math.min(120, Math.max(10, seconds));
  return clampedSeconds * 1000;
}
const DEFAULT_HOSTNAME = "127.0.0.1";
const OPENCODE_SERVER_STARTUP_MAX_OUTPUT_CHARS = 64 * 1024;
const OPENCODE_SKILL_DISCOVERY_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export interface OpenCodeServerProcess {
  readonly url: string;
  readonly serverPassword?: string;
  readonly version: string;
  readonly apiVersion: OpenCodeApiVersion;
  readonly isRunning: Effect.Effect<boolean>;
  readonly exitCode: Effect.Effect<number, never>;
}

export interface OpenCodeServerConnection {
  readonly url: string;
  readonly serverPassword?: string;
  readonly version: string;
  readonly apiVersion: OpenCodeApiVersion;
  readonly exitCode: Effect.Effect<number, never> | null;
  readonly external: boolean;
}

const OPENCODE_RUNTIME_ERROR_TAG = "OpenCodeRuntimeError";
export class OpenCodeRuntimeError extends Data.TaggedError(OPENCODE_RUNTIME_ERROR_TAG)<{
  readonly operation: string;
  readonly cause?: unknown;
  readonly detail: string;
}> {
  static readonly is = (u: unknown): u is OpenCodeRuntimeError =>
    P.isTagged(u, OPENCODE_RUNTIME_ERROR_TAG);
}

function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

export function openCodeRuntimeErrorDetail(cause: unknown): string {
  if (OpenCodeRuntimeError.is(cause)) return cause.detail;
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message.trim();
  if (cause && typeof cause === "object") {
    // SDK v2 throws { response, request, error? } shapes — extract what's useful
    const anyCause = cause as Record<string, unknown>;
    const status = (anyCause.response as { status?: number } | undefined)?.status;
    const body = anyCause.error ?? anyCause.data ?? anyCause.body;
    const encodedBody = encodeJsonStringForDiagnostics(body ?? cause);
    if (encodedBody) {
      return `status=${status ?? "?"} body=${encodedBody}`;
    }
  }
  return String(cause);
}

export const runOpenCodeSdk = <A>(
  operation: string,
  fn: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, OpenCodeRuntimeError> =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) =>
      new OpenCodeRuntimeError({ operation, detail: openCodeRuntimeErrorDetail(cause), cause }),
  }).pipe(Effect.withSpan(`opencode.${operation}`));

export const verifyOpenCodeServerVersion = Effect.fn("verifyOpenCodeServerVersion")(function* (
  client: OpencodeClient,
) {
  const healthOption = yield* runOpenCodeSdk("global.health", (signal) =>
    client.global.health({ signal }),
  ).pipe(Effect.timeoutOption(OPENCODE_HEALTH_TIMEOUT));
  if (Option.isNone(healthOption)) {
    return yield* new OpenCodeRuntimeError({
      operation: "global.health",
      detail: "Timed out while checking the OpenCode server version.",
    });
  }

  const health = yield* decodeOpenCodeHealth(healthOption.value.data).pipe(
    Effect.mapError(
      (cause) =>
        new OpenCodeRuntimeError({
          operation: "global.health",
          detail: `OpenCode server returned an invalid health response. T3 Code requires OpenCode v${MINIMUM_OPENCODE_VERSION} or newer.`,
          cause,
        }),
    ),
  );
  if (parseSemver(health.version) === null) {
    return yield* new OpenCodeRuntimeError({
      operation: "global.health",
      detail: `OpenCode server returned an invalid version. T3 Code requires OpenCode v${MINIMUM_OPENCODE_VERSION} or newer.`,
    });
  }
  if (compareSemverVersions(health.version, MINIMUM_OPENCODE_VERSION) < 0) {
    return yield* new OpenCodeRuntimeError({
      operation: "global.health",
      detail: `OpenCode v${health.version} is too old. Upgrade to v${MINIMUM_OPENCODE_VERSION} or newer.`,
    });
  }
  return health.version;
});

/**
 * Liveness check for v2-protocol servers (`/api/location`). OpenCode v2.0.5
 * does not expose `/api/health`; location is a cheap, directory-scoped
 * endpoint that exists across the v2 server releases we support. Unlike v1
 * health it carries no version, so the version comes from `opencode --version`
 * on the v2 path.
 */
export const pingOpenCodeServerV2 = Effect.fn("pingOpenCodeServerV2")(function* (
  client: OpencodeClient,
  directory: string,
) {
  const pingOption = yield* runOpenCodeSdk("location.get", (signal) =>
    client.v2.location.get({ location: { directory } }, { signal }),
  ).pipe(Effect.timeoutOption(OPENCODE_V2_PROBE_TIMEOUT));
  if (Option.isNone(pingOption)) {
    return yield* new OpenCodeRuntimeError({
      operation: "location.get",
      detail: "Timed out while checking the OpenCode server version.",
    });
  }
});

/**
 * Normalize a v2-protocol inventory (`/api/*` flat lists) into the shared
 * `OpenCodeInventory` shape. Listed providers count as connected: v2 omits
 * unknown providers from the list (detail 404s) and flags unusable ones with
 * `disabled`, mirroring the v1 `connected` subset.
 */
export function normalizeOpenCodeInventoryV2(input: {
  readonly providers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly disabled?: boolean | undefined;
    readonly activation?: string | undefined;
  }>;
  readonly models: ReadonlyArray<{
    readonly id: string;
    readonly providerID: string;
    readonly name?: string | null | undefined;
    readonly variants?: ReadonlyArray<{ readonly id: string }> | undefined;
    readonly enabled?: boolean | undefined;
  }>;
  readonly agents: ReadonlyArray<{
    readonly id?: string | undefined;
    readonly name?: string | undefined;
    readonly mode: string;
    readonly hidden?: boolean | undefined;
  }>;
  readonly skills: ReadonlyArray<OpenCodeSkill>;
}): OpenCodeInventory {
  const usableProviders = input.providers.filter(
    (provider) => !provider.disabled && provider.activation !== "disabled",
  );
  const usableIds = new Set(usableProviders.map((provider) => provider.id));
  const modelsByProvider = new Map<string, Record<string, OpenCodeInventoryModel>>();
  for (const model of input.models) {
    if (!usableIds.has(model.providerID) || model.enabled === false) {
      continue;
    }
    const name = model.name?.trim();
    if (!name) {
      continue;
    }
    let bucket = modelsByProvider.get(model.providerID);
    if (!bucket) {
      bucket = {};
      modelsByProvider.set(model.providerID, bucket);
    }
    const variants: Record<string, unknown> = {};
    for (const variant of model.variants ?? []) {
      variants[variant.id] = {};
    }
    bucket[model.id] = { id: model.id, name, variants };
  }
  return {
    providerList: {
      connected: usableProviders.map((provider) => provider.id),
      all: usableProviders.map((provider) => ({
        id: provider.id,
        name: provider.name,
        models: modelsByProvider.get(provider.id) ?? {},
      })),
    },
    agents: input.agents.map((agent) => ({
      name: agent.name ?? agent.id ?? "agent",
      mode: agent.mode,
      ...(agent.hidden !== undefined ? { hidden: agent.hidden } : {}),
    })),
    skills: input.skills.map((skill) => ({ ...skill })),
  };
}

export interface OpenCodeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export type OpenCodeApiVersion = "v1" | "v2";

/**
 * Minimal model/provider/agent shapes shared by the v1 and v2 inventory
 * payloads. v1 servers return the SDK's ProviderListResponse; v2 servers
 * return flat `/api/*` lists that are regrouped into the same shape at the
 * runtime boundary, so the snapshot layer stays protocol-agnostic.
 */
export interface OpenCodeInventoryModel {
  readonly id: string;
  readonly name?: string | null | undefined;
  readonly variants?: Readonly<Record<string, unknown>> | undefined;
}

export interface OpenCodeInventoryProvider {
  readonly id: string;
  readonly name: string;
  readonly models: Readonly<Record<string, OpenCodeInventoryModel>>;
}

export interface OpenCodeInventoryAgent {
  readonly name: string;
  readonly mode: string;
  readonly hidden?: boolean | undefined;
}

export interface OpenCodeInventory {
  readonly providerList: {
    readonly connected: ReadonlyArray<string>;
    readonly all: ReadonlyArray<OpenCodeInventoryProvider>;
  };
  readonly agents: ReadonlyArray<OpenCodeInventoryAgent>;
  readonly skills: ReadonlyArray<OpenCodeSkill>;
  readonly commands?: ReadonlyArray<OpenCodeSlashCommand>;
}

export type OpenCodeSlashCommand = Pick<Command, "name" | "description" | "source" | "hints">;

/** Command templates stay in OpenCode, which expands arguments and runs MCP prompts. */
export const loadOpenCodeCommands = (client: OpencodeClient) =>
  runOpenCodeSdk("command.list", (signal) => client.command.list(undefined, { signal })).pipe(
    Effect.map((result): ReadonlyArray<OpenCodeSlashCommand> =>
      (result.data ?? []).map(({ name, description, source, hints }) => ({
        name,
        ...(description === undefined ? {} : { description }),
        ...(source === undefined ? {} : { source }),
        hints,
      })),
    ),
  );

export interface ParsedOpenCodeModelSlug {
  readonly providerID: string;
  readonly modelID: string;
}

export interface OpenCodeSkill {
  readonly name?: string | null;
  readonly description?: string | null;
  readonly location?: string | null;
}

const OpenCodeSkillSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  location: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeOpenCodeSkillsCliOutputExit = Schema.decodeUnknownExit(
  Schema.fromJsonString(Schema.Array(OpenCodeSkillSchema)),
);

export interface OpenCodeRuntimeShape {
  /**
   * Spawns a local OpenCode server process. Its lifetime is bound to the caller's
   * `Scope.Scope` — the child is killed automatically when that scope closes.
   * Consumers that want a long-lived server must create and hold a scope explicitly
   * (see {@link Scope.make}) and close it when done.
   */
  readonly startOpenCodeServerProcess: (input: {
    readonly binaryPath: string;
    readonly directory: string;
    readonly serverPassword?: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly port?: number;
    readonly hostname?: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<OpenCodeServerProcess, OpenCodeRuntimeError, Scope.Scope>;
  /**
   * Returns a handle to either an externally-managed OpenCode server (when
   * `serverUrl` is provided — no lifetime is attached to the caller's scope) or a
   * freshly spawned local server whose lifetime is bound to the caller's scope.
   */
  readonly connectToOpenCodeServer: (input: {
    readonly binaryPath: string;
    readonly directory: string;
    readonly serverUrl?: string | null;
    readonly serverPassword?: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly port?: number;
    readonly hostname?: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<OpenCodeServerConnection, OpenCodeRuntimeError, Scope.Scope>;
  readonly runOpenCodeCommand: (input: {
    readonly binaryPath: string;
    readonly args: ReadonlyArray<string>;
    readonly environment?: NodeJS.ProcessEnv;
    readonly cwd?: string;
    readonly maxOutputBytes?: number;
  }) => Effect.Effect<OpenCodeCommandResult, OpenCodeRuntimeError>;
  readonly createOpenCodeSdkClient: (input: {
    readonly baseUrl: string;
    readonly directory: string;
    readonly serverPassword?: string;
  }) => OpencodeClient;
  readonly loadOpenCodeInventory: (
    client: OpencodeClient,
  ) => Effect.Effect<OpenCodeInventory, OpenCodeRuntimeError>;
  readonly loadOpenCodeSkills: (
    client: OpencodeClient,
  ) => Effect.Effect<ReadonlyArray<OpenCodeSkill>, OpenCodeRuntimeError>;
  /**
   * v2-protocol variants (`/api/*`) of the inventory loaders. The payloads are
   * normalized into the shared `OpenCodeInventory` shape so snapshot code stays
   * protocol-agnostic. `directory` scopes the per-workspace endpoints (skills).
   */
  readonly loadOpenCodeInventoryV2: (
    client: OpencodeClient,
    directory: string,
  ) => Effect.Effect<OpenCodeInventory, OpenCodeRuntimeError>;
  readonly loadOpenCodeSkillsV2: (
    client: OpencodeClient,
    directory: string,
  ) => Effect.Effect<ReadonlyArray<OpenCodeSkill>, OpenCodeRuntimeError>;
  readonly loadInventoryFromCli: (input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<OpenCodeInventory, OpenCodeRuntimeError>;
  readonly loadSkillsFromCli: (input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<ReadonlyArray<OpenCodeSkill>, OpenCodeRuntimeError>;
}

/** @internal */
export function parseServerUrlFromOutput(output: string): string | null {
  for (const line of output.split("\n")) {
    // v1 prints "opencode server listening on ...", v2 prints "server listening on ...".
    const match = line.match(/(?:opencode )?server listening\s+on\s+(https?:\/\/[^\s]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

const SLUG_LINE_RE = /^(\S+\/\S+)\s*$/;
const AGENT_HEADER_RE = /^(.+)\s+\((\S+)\)\s*$/;

// Agents that are always hidden in OpenCode but the CLI "agent list" command
// does not expose the hidden flag. Keep in sync with OpenCode agent
// definitions (in the OpenCode repo: packages/opencode/src/agent/agent.ts).
const KNOWN_HIDDEN_AGENTS = new Set(["compaction", "summary", "title"]);

/** @internal */
export function parseModelsCliOutput(stdout: string): {
  readonly providers: ReadonlyMap<
    string,
    { readonly id: string; readonly name: string; readonly models: { [key: string]: Model } }
  >;
  readonly connected: ReadonlyArray<string>;
} {
  const providers = new Map<
    string,
    { id: string; name: string; models: { [key: string]: Model } }
  >();
  const lines = stdout.split("\n");
  let currentSlug: string | null = null;
  const jsonLines: Array<string> = [];

  const flushModel = () => {
    if (currentSlug !== null && jsonLines.length > 0) {
      const jsonStr = jsonLines.join("\n").trim();
      if (jsonStr.length > 0) {
        try {
          const model = JSON.parse(jsonStr) as Model;
          const separator = currentSlug.indexOf("/");
          if (separator > 0) {
            const providerID = currentSlug.slice(0, separator);
            const modelID = currentSlug.slice(separator + 1);
            let provider = providers.get(providerID);
            if (!provider) {
              provider = { id: providerID, name: providerID, models: {} };
              providers.set(providerID, provider);
            }
            provider.models[modelID] = model;
          }
        } catch {
          // Skip unparseable model JSON
        }
      }
    }
    currentSlug = null;
    jsonLines.length = 0;
  };

  for (const line of lines) {
    // A model's JSON body is a single `JSON.stringify` line starting with `{`,
    // while a provider/model slug is a bare `provider/model` header. Only the
    // latter can be a slug: without this guard a body line with no interior
    // whitespace and a `/` in one of its values (e.g. an OpenRouter model whose
    // `id` is `vendor/model`) matches SLUG_LINE_RE, so flushModel runs against
    // an empty body and the model is silently dropped.
    const slugMatch = line.trimStart().startsWith("{") ? null : SLUG_LINE_RE.exec(line);
    if (slugMatch) {
      flushModel();
      currentSlug = slugMatch[1]!;
    } else if (currentSlug !== null) {
      jsonLines.push(line);
    }
  }
  flushModel();

  return { providers, connected: [...providers.keys()] };
}

/** @internal */
export function parseAgentListCliOutput(stdout: string): ReadonlyArray<Agent> {
  const agents: Array<Agent> = [];
  const lines = stdout.split("\n");
  let currentHeader: { name: string; mode: string } | null = null;
  const blockLines: Array<string> = [];

  const flushAgent = () => {
    if (currentHeader !== null) {
      const jsonStr = blockLines.join("\n").trim();
      if (jsonStr.length > 0) {
        try {
          const permission = JSON.parse(jsonStr);
          agents.push({
            name: currentHeader.name,
            mode: currentHeader.mode as Agent["mode"],
            hidden: KNOWN_HIDDEN_AGENTS.has(currentHeader.name),
            permission,
            options: {},
          });
        } catch {
          // Skip unparseable agent
        }
      }
    }
    currentHeader = null;
    blockLines.length = 0;
  };

  for (const line of lines) {
    const match = AGENT_HEADER_RE.exec(line);
    if (match) {
      flushAgent();
      currentHeader = { name: match[1]!, mode: match[2]! };
    } else if (currentHeader !== null) {
      blockLines.push(line);
    }
  }
  flushAgent();

  return agents;
}

/** @internal */
export function parseSkillsCliOutput(stdout: string): ReadonlyArray<OpenCodeSkill> {
  const result = decodeOpenCodeSkillsCliOutputExit(stdout);
  return Exit.isSuccess(result) ? result.value : [];
}

export function parseOpenCodeModelSlug(
  slug: string | null | undefined,
): ParsedOpenCodeModelSlug | null {
  if (typeof slug !== "string") {
    return null;
  }

  const trimmed = slug.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }

  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  };
}

export function openCodeQuestionId(
  index: number,
  question: QuestionRequest["questions"][number],
): string {
  const header = question.header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  return header.length > 0 ? `question-${index}-${header}` : `question-${index}`;
}

/**
 * Attachments OpenCode can hand to a model as a native file part. Anything
 * else (ZIP, binaries, image formats like BMP/AVIF/SVG that model APIs
 * reject, or files over the direct-attachment size limit) would make the turn
 * fail before it starts, so those ride only as the file path ProviderService
 * puts in the prompt.
 */
const OPENCODE_NATIVE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const OPENCODE_NATIVE_FILE_PART_MAX_BYTES = 20 * 1024 * 1024;

function isOpenCodeNativeFilePart(input: {
  readonly mimeType: string;
  readonly sizeBytes: number;
}): boolean {
  if (input.sizeBytes > OPENCODE_NATIVE_FILE_PART_MAX_BYTES) {
    return false;
  }
  const normalized = input.mimeType.trim().toLowerCase();
  return (
    OPENCODE_NATIVE_IMAGE_MIMES.has(normalized) ||
    normalized.startsWith("text/") ||
    normalized === "application/pdf"
  );
}

export function toOpenCodeFileParts(input: {
  readonly attachments: ReadonlyArray<ChatAttachment> | undefined;
  readonly resolveAttachmentPath: (attachment: ChatAttachment) => string | null;
}): Array<FilePartInput> {
  const parts: Array<FilePartInput> = [];

  for (const attachment of input.attachments ?? []) {
    if (
      attachment.type === "file" &&
      "source" in attachment &&
      attachment.source?._tag === "pasted-text"
    ) {
      continue;
    }
    if (!isOpenCodeNativeFilePart(attachment)) {
      continue;
    }
    const attachmentPath = input.resolveAttachmentPath(attachment);
    if (!attachmentPath) {
      continue;
    }

    parts.push({
      type: "file",
      mime: attachment.mimeType,
      filename: attachment.name,
      url: NodeURL.pathToFileURL(attachmentPath).href,
    });
  }

  return parts;
}

export function buildOpenCodePermissionRules(runtimeMode: RuntimeMode): PermissionRuleset {
  if (runtimeMode === "full-access") {
    return [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "external_directory", pattern: "*", action: "allow" },
    ];
  }

  // "Auto-accept edits" is documented as "auto-approve edits, ask before other
  // actions", so prompting for every edit ignores the mode the user picked.
  // "auto" is left asking on purpose: the docs say providers without an AI
  // reviewer, OpenCode among them, fall back to Supervised for that mode.
  const editAction = runtimeMode === "auto-accept-edits" ? "allow" : "ask";

  // Session rules override OpenCode's agent defaults. Allow reads and task
  // updates, but keep its default approval rules for environment files.
  return [
    { permission: "*", pattern: "*", action: "ask" },
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "read", pattern: "*.env", action: "ask" },
    { permission: "read", pattern: "*.env.*", action: "ask" },
    { permission: "read", pattern: "*.env.example", action: "allow" },
    { permission: "glob", pattern: "*", action: "allow" },
    { permission: "grep", pattern: "*", action: "allow" },
    { permission: "lsp", pattern: "*", action: "allow" },
    { permission: "skill", pattern: "*", action: "allow" },
    { permission: "todowrite", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "*", action: "ask" },
    { permission: "edit", pattern: "*", action: editAction },
    { permission: "webfetch", pattern: "*", action: "ask" },
    { permission: "websearch", pattern: "*", action: "ask" },
    { permission: "codesearch", pattern: "*", action: "ask" },
    { permission: "external_directory", pattern: "*", action: "ask" },
    { permission: "doom_loop", pattern: "*", action: "ask" },
    { permission: "question", pattern: "*", action: "allow" },
  ];
}

export function toOpenCodePermissionReply(
  decision: ProviderApprovalDecision,
): "once" | "always" | "reject" {
  switch (decision) {
    case "accept":
      return "once";
    case "acceptForSession":
    case "acceptAlways":
      return "always";
    case "decline":
    case "cancel":
    default:
      return "reject";
  }
}

export function toOpenCodeQuestionAnswers(
  request: QuestionRequest,
  answers: Record<string, unknown>,
): Array<QuestionAnswer> {
  return request.questions.map((question, index) => {
    const raw =
      answers[openCodeQuestionId(index, question)] ??
      answers[question.header] ??
      answers[question.question];
    if (Array.isArray(raw)) {
      return raw.filter((value): value is string => typeof value === "string");
    }
    if (typeof raw === "string") {
      return raw.trim().length > 0 ? [raw] : [];
    }
    return [];
  });
}

function ensureRuntimeError(
  operation: OpenCodeRuntimeError["operation"],
  detail: string,
  cause: unknown,
): OpenCodeRuntimeError {
  return OpenCodeRuntimeError.is(cause)
    ? cause
    : new OpenCodeRuntimeError({ operation, detail, cause });
}

const makeOpenCodeRuntime = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const netService = yield* NetService.NetService;
  const hostPlatform = yield* HostProcessPlatform;
  const resolveCommand = (command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
    resolveSpawnCommand(command, args, env ? { env } : {});

  const runOpenCodeCommand: OpenCodeRuntimeShape["runOpenCodeCommand"] = (input) =>
    Effect.gen(function* () {
      const spawnCommand = yield* resolveCommand(input.binaryPath, input.args, input.environment);
      const child = yield* spawner.spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          detached: hostPlatform !== "win32",
          shell: spawnCommand.shell,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.environment ? { env: input.environment } : { extendEnv: true }),
        }),
      );
      const terminateCommandGroup =
        hostPlatform === "win32"
          ? child.kill({ killSignal: "SIGKILL" }).pipe(Effect.asVoid)
          : Effect.sync(() => {
              try {
                process.kill(-Number(child.pid), "SIGKILL");
              } catch {
                // The command and its process group may already have exited.
              }
            });
      yield* Effect.addFinalizer(() => terminateCommandGroup.pipe(Effect.ignore));
      const collectOptions =
        input.maxOutputBytes === undefined ? undefined : { maxBytes: input.maxOutputBytes };
      const [stdout, stderr, code] = yield* Effect.all(
        [
          collectStreamAsString(child.stdout, collectOptions),
          collectStreamAsString(child.stderr, collectOptions),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      const exitCode = Number(code);
      if (yield* isWindowsCommandNotFound(exitCode, stderr)) {
        return yield* new OpenCodeRuntimeError({
          operation: "runOpenCodeCommand",
          detail: `spawn ${input.binaryPath} ENOENT`,
        });
      }
      return {
        stdout,
        stderr,
        code: exitCode,
      } satisfies OpenCodeCommandResult;
    }).pipe(
      Effect.scoped,
      Effect.mapError((cause) =>
        ensureRuntimeError(
          "runOpenCodeCommand",
          `Failed to execute '${input.binaryPath} ${input.args.join(" ")}': ${openCodeRuntimeErrorDetail(cause)}`,
          cause,
        ),
      ),
    );

  const createOpenCodeSdkClient: OpenCodeRuntimeShape["createOpenCodeSdkClient"] = (input) =>
    createOpencodeClient({
      baseUrl: input.baseUrl,
      directory: input.directory,
      ...(input.serverPassword
        ? {
            headers: {
              Authorization: `Basic ${Buffer.from(`opencode:${input.serverPassword}`, "utf8").toString("base64")}`,
            },
          }
        : {}),
      throwOnError: true,
    });

  /**
   * Best-effort CLI version for a server handle: runs `opencode --version`
   * through the configured binary and applies the minimum-version gate. Used
   * on the v2 path, where the API health check carries no version.
   */
  const cliVersionForServer = (input: {
    readonly binaryPath: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) =>
    runOpenCodeCommand({
      binaryPath: input.binaryPath,
      args: ["--version"],
      ...(input.environment !== undefined ? { environment: input.environment } : {}),
    }).pipe(
      Effect.flatMap((result) => {
        const version = parseGenericCliVersion(result.stdout) ?? null;
        if (!version) {
          return Effect.fail(
            new OpenCodeRuntimeError({
              operation: "cli-version",
              detail: `Unable to determine OpenCode version from \`opencode --version\` output. T3 Code requires OpenCode v${MINIMUM_OPENCODE_VERSION} or newer.`,
            }),
          );
        }
        if (compareSemverVersions(version, MINIMUM_OPENCODE_VERSION) < 0) {
          return Effect.fail(
            new OpenCodeRuntimeError({
              operation: "cli-version",
              detail: `OpenCode v${version} is too old. Upgrade to v${MINIMUM_OPENCODE_VERSION} or newer.`,
            }),
          );
        }
        return Effect.succeed(version);
      }),
    );

  /**
   * Confirms a reachable server speaks either protocol. The v2 probe runs first
   * because OpenCode v2.0.5 leaves legacy routes on the web-app fallback, which
   * can otherwise make a v1 health request hang before v2 detection runs. A v1
   * health check remains the fallback for older servers.
   */
  const verifyAnyProtocolServer = (input: {
    readonly client: OpencodeClient;
    readonly directory: string;
    readonly binaryPath: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) =>
    Effect.gen(function* () {
      const v2Exit = yield* pingOpenCodeServerV2(input.client, input.directory).pipe(Effect.exit);
      if (Exit.isSuccess(v2Exit)) {
        const version = yield* cliVersionForServer({
          binaryPath: input.binaryPath,
          ...(input.environment !== undefined ? { environment: input.environment } : {}),
        });
        return { apiVersion: "v2" as const, version };
      }
      const v1Exit = yield* verifyOpenCodeServerVersion(input.client).pipe(Effect.exit);
      if (Exit.isSuccess(v1Exit)) {
        return { apiVersion: "v1" as const, version: v1Exit.value };
      }
      return yield* Effect.failCause(v1Exit.cause);
    });

  const startOpenCodeServerProcess: OpenCodeRuntimeShape["startOpenCodeServerProcess"] = (input) =>
    Effect.gen(function* () {
      // Bind this server's lifetime to the caller's scope. When the caller's
      // scope closes, the spawned child is killed and all associated fibers
      // are interrupted automatically — no `close()` method needed.
      const runtimeScope = yield* Scope.Scope;

      const hostname = input.hostname ?? DEFAULT_HOSTNAME;
      const port =
        input.port ??
        (yield* netService.findAvailablePort(0).pipe(
          Effect.mapError(
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "startOpenCodeServerProcess",
                detail: `Failed to find available port: ${openCodeRuntimeErrorDetail(cause)}`,
                cause,
              }),
          ),
        ));
      const timeoutMs = input.timeoutMs ?? DEFAULT_OPENCODE_SERVER_TIMEOUT_MS;
      const args = ["serve", `--hostname=${hostname}`, `--port=${port}`];
      const spawnCommand = yield* resolveCommand(input.binaryPath, args, input.environment);
      // OpenCode v2 only mounts the API (health, providers, sessions) when the
      // server has a password; without one it prints a generated password and
      // serves the web UI instead, so every API call misses. Always spawn with
      // a password — the configured one when present, otherwise an ephemeral
      // one returned on the handle for the SDK client. v1 honors the same env
      // var, so this is transparent there too.
      const serverPassword =
        resolveOpenCodeServerPassword({
          external: false,
          ...(input.serverPassword !== undefined ? { serverPassword: input.serverPassword } : {}),
          ...(input.environment !== undefined ? { environment: input.environment } : {}),
        }) ?? NodeCrypto.randomBytes(32).toString("hex");

      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            detached: hostPlatform !== "win32",
            shell: spawnCommand.shell,
            env: {
              ...input.environment,
              OPENCODE_SERVER_PASSWORD: serverPassword,
              // Respect an OPENCODE_CONFIG_CONTENT provided by the caller or
              // the inherited process environment, only falling back to the
              // empty config when neither is set. Setting it unconditionally
              // previously clobbered the user's opencode config, hiding their
              // providers/models. The value is set explicitly (rather than
              // relying on inheritance) because `extendEnv` is false whenever
              // `input.environment` is provided.
              OPENCODE_CONFIG_CONTENT: resolveOpenCodeConfigContent(input.environment),
            },
            extendEnv: input.environment === undefined,
          }),
        )
        .pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
          Effect.mapError(
            (cause) =>
              new OpenCodeRuntimeError({
                operation: "startOpenCodeServerProcess",
                detail: `Failed to spawn OpenCode server process: ${openCodeRuntimeErrorDetail(cause)}`,
                cause,
              }),
          ),
        );

      const killOpenCodeProcessGroup = (signal: NodeJS.Signals) =>
        hostPlatform === "win32"
          ? child.kill({ killSignal: signal, forceKillAfter: "1 second" }).pipe(Effect.asVoid)
          : Effect.sync(() => {
              try {
                process.kill(-Number(child.pid), signal);
              } catch {
                // The direct child may already have exited after starting the
                // server; the process group kill is best-effort cleanup for
                // any serve process left in that group.
              }
            });
      const terminateChild = killOpenCodeProcessGroup("SIGTERM").pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.andThen(killOpenCodeProcessGroup("SIGKILL")),
        Effect.ignore,
      );
      yield* Scope.addFinalizer(runtimeScope, terminateChild);

      const stdoutRef = yield* Ref.make<string | null>("");
      const stderrRef = yield* Ref.make<string | null>("");
      const readyDeferred = yield* Deferred.make<string, OpenCodeRuntimeError>();

      const setReadyFromStdoutChunk = (chunk: string) =>
        Ref.modify(stdoutRef, (stdout) => {
          if (stdout === null) {
            return [null, null] as const;
          }
          const nextStdout = `${stdout}${chunk}`;
          return [
            parseServerUrlFromOutput(nextStdout),
            nextStdout.slice(-OPENCODE_SERVER_STARTUP_MAX_OUTPUT_CHARS),
          ] as const;
        }).pipe(
          Effect.flatMap((parsed) =>
            parsed ? Deferred.succeed(readyDeferred, parsed).pipe(Effect.ignore) : Effect.void,
          ),
        );

      const stdoutFiber = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.runForEach(setReadyFromStdoutChunk),
        Effect.ignore,
        Effect.forkIn(runtimeScope),
      );
      const stderrFiber = yield* child.stderr.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Ref.update(stderrRef, (stderr) =>
            stderr === null
              ? null
              : `${stderr}${chunk}`.slice(-OPENCODE_SERVER_STARTUP_MAX_OUTPUT_CHARS),
          ),
        ),
        Effect.ignore,
        Effect.forkIn(runtimeScope),
      );

      const exitFiber = yield* child.exitCode.pipe(
        Effect.flatMap((code) =>
          Effect.gen(function* () {
            const stdout = (yield* Ref.get(stdoutRef)) ?? "";
            const stderr = (yield* Ref.get(stderrRef)) ?? "";
            const exitCode = Number(code);
            yield* Deferred.fail(
              readyDeferred,
              new OpenCodeRuntimeError({
                operation: "startOpenCodeServerProcess",
                detail: [
                  `OpenCode server exited before startup completed (code: ${String(exitCode)}).`,
                  stdout.trim() ? `stdout:\n${stdout.trim()}` : null,
                  stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
                cause: { exitCode, stdout, stderr },
              }),
            ).pipe(Effect.ignore);
          }),
        ),
        Effect.ignore,
        Effect.forkIn(runtimeScope),
      );

      const readyExit = yield* Effect.exit(
        Deferred.await(readyDeferred).pipe(Effect.timeoutOption(timeoutMs)),
      );

      if (Exit.isFailure(readyExit) || Option.isNone(readyExit.value)) {
        yield* Fiber.interruptAll([stdoutFiber, stderrFiber, exitFiber]).pipe(Effect.ignore);
      }

      if (Exit.isFailure(readyExit)) {
        const squashed = Cause.squash(readyExit.cause);
        return yield* ensureRuntimeError(
          "startOpenCodeServerProcess",
          `Failed while waiting for OpenCode server startup: ${openCodeRuntimeErrorDetail(squashed)}`,
          squashed,
        );
      }

      const readyOption = readyExit.value;
      if (Option.isNone(readyOption)) {
        return yield* new OpenCodeRuntimeError({
          operation: "startOpenCodeServerProcess",
          detail: `Timed out waiting for OpenCode server start after ${timeoutMs}ms.`,
        });
      }

      // Keep draining both pipes until the process scope closes. Stopping the
      // readers can block OpenCode when its output buffers fill. Startup output
      // is no longer needed, so discard later output instead of retaining it.
      yield* Ref.set(stdoutRef, null);
      yield* Ref.set(stderrRef, null);

      const url = readyOption.value;
      const verified = yield* verifyAnyProtocolServer({
        client: createOpenCodeSdkClient({
          baseUrl: url,
          directory: input.directory,
          serverPassword,
        }),
        directory: input.directory,
        binaryPath: input.binaryPath,
        ...(input.environment !== undefined ? { environment: input.environment } : {}),
      });

      return {
        url,
        serverPassword,
        version: verified.version,
        apiVersion: verified.apiVersion,
        isRunning: child.isRunning.pipe(Effect.orElseSucceed(() => false)),
        exitCode: child.exitCode.pipe(
          Effect.map(Number),
          Effect.orElseSucceed(() => 0),
        ),
      } satisfies OpenCodeServerProcess;
    });

  const connectToOpenCodeServer: OpenCodeRuntimeShape["connectToOpenCodeServer"] = (input) => {
    const serverUrl = input.serverUrl?.trim();
    if (serverUrl) {
      const serverPassword = resolveOpenCodeServerPassword({
        external: true,
        ...(input.serverPassword !== undefined ? { serverPassword: input.serverPassword } : {}),
      });
      return Effect.gen(function* () {
        const verified = yield* verifyAnyProtocolServer({
          client: createOpenCodeSdkClient({
            baseUrl: serverUrl,
            directory: input.directory,
            ...(serverPassword !== undefined ? { serverPassword } : {}),
          }),
          directory: input.directory,
          binaryPath: input.binaryPath,
          ...(input.environment !== undefined ? { environment: input.environment } : {}),
        });
        return {
          url: serverUrl,
          ...(serverPassword !== undefined ? { serverPassword } : {}),
          version: verified.version,
          apiVersion: verified.apiVersion,
          exitCode: null,
          external: true,
        } satisfies OpenCodeServerConnection;
      });
    }

    return startOpenCodeServerProcess({
      binaryPath: input.binaryPath,
      directory: input.directory,
      ...(input.serverPassword !== undefined ? { serverPassword: input.serverPassword } : {}),
      ...(input.environment !== undefined ? { environment: input.environment } : {}),
      ...(input.port !== undefined ? { port: input.port } : {}),
      ...(input.hostname !== undefined ? { hostname: input.hostname } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    }).pipe(
      Effect.map((server): OpenCodeServerConnection => ({
        url: server.url,
        ...(server.serverPassword !== undefined ? { serverPassword: server.serverPassword } : {}),
        version: server.version,
        apiVersion: server.apiVersion,
        exitCode: server.exitCode,
        external: false,
      })),
    );
  };

  const loadProviders = (client: OpencodeClient) =>
    runOpenCodeSdk("provider.list", (signal) => client.provider.list(undefined, { signal })).pipe(
      Effect.filterMapOrFail(
        (list) =>
          list.data
            ? Result.succeed(list.data)
            : Result.fail(
                new OpenCodeRuntimeError({
                  operation: "provider.list",
                  detail: "OpenCode provider list was empty.",
                }),
              ),
        (result) => result,
      ),
    );

  const loadAgents = (client: OpencodeClient) =>
    runOpenCodeSdk("app.agents", (signal) => client.app.agents(undefined, { signal })).pipe(
      Effect.map((result) => result.data ?? []),
      Effect.orElseSucceed((): ReadonlyArray<Agent> => []),
    );

  const loadOpenCodeSkills: OpenCodeRuntimeShape["loadOpenCodeSkills"] = (client) =>
    runOpenCodeSdk("app.skills", (signal) => client.app.skills(undefined, { signal })).pipe(
      Effect.map((result) =>
        (result.data ?? []).map((skill) => ({
          name: skill.name,
          ...(skill.description === undefined ? {} : { description: skill.description }),
          // OpenCode v2.0.5 called this field `path`; newer SDK schemas call it
          // `location`. The SDK does not validate response payloads, so accept
          // both wire names at this boundary.
          location:
            skill.location ??
            (skill as typeof skill & { readonly path?: string }).path ??
            undefined,
        })),
      ),
    );
  const loadSkills = (client: OpencodeClient) =>
    loadOpenCodeSkills(client).pipe(Effect.orElseSucceed((): ReadonlyArray<OpenCodeSkill> => []));

  const loadOpenCodeInventory: OpenCodeRuntimeShape["loadOpenCodeInventory"] = (client) =>
    Effect.all(
      [
        loadProviders(client),
        loadAgents(client),
        loadSkills(client),
        loadOpenCodeCommands(client).pipe(Effect.orElseSucceed(() => [])),
      ],
      {
        concurrency: "unbounded",
      },
    ).pipe(
      Effect.map(([providerList, agents, skills, commands]) => ({
        providerList,
        agents,
        skills,
        commands,
      })),
    );

  const loadV2Providers = (client: OpencodeClient, directory: string) =>
    runOpenCodeSdk("provider.list", (signal) =>
      client.v2.provider.list({ location: { directory } }, { signal }),
    ).pipe(
      Effect.filterMapOrFail(
        (list) =>
          list.data?.data
            ? Result.succeed(list.data.data)
            : Result.fail(
                new OpenCodeRuntimeError({
                  operation: "provider.list",
                  detail: "OpenCode provider list was empty.",
                }),
              ),
        (result) => result,
      ),
    );

  const loadV2Models = (client: OpencodeClient, directory: string) =>
    runOpenCodeSdk("model.list", (signal) =>
      client.v2.model.list({ location: { directory } }, { signal }),
    ).pipe(
      Effect.filterMapOrFail(
        (list) =>
          list.data?.data
            ? Result.succeed(list.data.data)
            : Result.fail(
                new OpenCodeRuntimeError({
                  operation: "model.list",
                  detail: "OpenCode model list was empty.",
                }),
              ),
        (result) => result,
      ),
    );

  const loadV2Agents = (client: OpencodeClient, directory: string) =>
    runOpenCodeSdk("agent.list", (signal) =>
      client.v2.agent.list({ location: { directory } }, { signal }),
    ).pipe(
      Effect.map((result) => result.data?.data ?? []),
      Effect.orElseSucceed(() => [] as const),
    );

  const loadOpenCodeSkillsV2: OpenCodeRuntimeShape["loadOpenCodeSkillsV2"] = (client, directory) =>
    runOpenCodeSdk("skill.list", (signal) =>
      client.v2.skill.list({ location: { directory } }, { signal }),
    ).pipe(
      Effect.map((result) =>
        (result.data?.data ?? []).map((skill) => ({
          name: skill.name,
          ...(skill.description === undefined ? {} : { description: skill.description }),
          location:
            skill.location ??
            (skill as typeof skill & { readonly path?: string }).path ??
            undefined,
        })),
      ),
    );
  const loadSkillsV2 = (client: OpencodeClient, directory: string) =>
    loadOpenCodeSkillsV2(client, directory).pipe(
      Effect.orElseSucceed((): ReadonlyArray<OpenCodeSkill> => []),
    );

  const loadOpenCodeInventoryV2: OpenCodeRuntimeShape["loadOpenCodeInventoryV2"] = (
    client,
    directory,
  ) =>
    Effect.all(
      [
        loadV2Providers(client, directory),
        loadV2Models(client, directory),
        loadV2Agents(client, directory),
        loadSkillsV2(client, directory),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map(([providers, models, agents, skills]) =>
        normalizeOpenCodeInventoryV2({ providers, models, agents, skills }),
      ),
    );

  const loadInventoryFromCli: OpenCodeRuntimeShape["loadInventoryFromCli"] = (input) =>
    Effect.gen(function* () {
      const env = input.environment !== undefined ? { environment: input.environment } : ({} as {});
      const commandContext = { cwd: input.cwd, ...env };

      const runModelsCli = () =>
        runOpenCodeCommand({
          binaryPath: input.binaryPath,
          args: ["models", "--verbose"],
          ...commandContext,
        }).pipe(Effect.exit);
      const runAgentsCli = () =>
        runOpenCodeCommand({
          binaryPath: input.binaryPath,
          args: ["agent", "list"],
          ...commandContext,
        }).pipe(Effect.exit);
      const runSkillsCli = () =>
        runOpenCodeCommand({
          binaryPath: input.binaryPath,
          args: ["debug", "skill"],
          maxOutputBytes: OPENCODE_SKILL_DISCOVERY_MAX_OUTPUT_BYTES,
          ...commandContext,
        }).pipe(Effect.exit);

      // Every OpenCode CLI command opens the same shared SQLite database. Running them
      // concurrently causes "database is locked" failures, so run them one at a time.
      const [initialModelsResult, initialAgentsResult, initialSkillsResult] = yield* Effect.all(
        [runModelsCli(), runAgentsCli(), runSkillsCli()],
        { concurrency: 1 },
      );
      let modelsResult = initialModelsResult;
      let agentsResult = initialAgentsResult;
      let skillsResult = initialSkillsResult;

      // Retry once after 1s on transient failures (e.g. SQLite "database is locked")
      const needsModelsRetry = modelsResult._tag === "Failure" || modelsResult.value.code !== 0;
      const needsAgentsRetry = agentsResult._tag === "Failure" || agentsResult.value.code !== 0;
      const needsSkillsRetry = skillsResult._tag === "Failure" || skillsResult.value.code !== 0;
      if (needsModelsRetry || needsAgentsRetry || needsSkillsRetry) {
        yield* Effect.sleep("1 second");
        const [m2, a2, s2] = yield* Effect.all(
          [
            needsModelsRetry ? runModelsCli() : Effect.succeed(modelsResult),
            needsAgentsRetry ? runAgentsCli() : Effect.succeed(agentsResult),
            needsSkillsRetry ? runSkillsCli() : Effect.succeed(skillsResult),
          ],
          { concurrency: 1 },
        );
        modelsResult = m2;
        agentsResult = a2;
        skillsResult = s2;
      }

      if (modelsResult._tag === "Failure") {
        const cause = Cause.squash(modelsResult.cause);
        return yield* ensureRuntimeError(
          "loadInventoryFromCli",
          `Failed to load OpenCode models: ${openCodeRuntimeErrorDetail(cause)}`,
          cause,
        );
      }
      if (modelsResult.value.code !== 0) {
        return yield* new OpenCodeRuntimeError({
          operation: "loadInventoryFromCli",
          detail: `OpenCode models command exited with code ${modelsResult.value.code}.`,
        });
      }

      const parsed = parseModelsCliOutput(modelsResult.value.stdout);
      const connected = [...parsed.connected];
      const allProviders: ProviderListResponse["all"] = [...parsed.providers.values()].map(
        (provider) => ({
          id: provider.id,
          name: provider.name,
          source: "config" as const,
          env: [],
          options: {},
          models: provider.models,
        }),
      );

      // Agent and skill metadata enrich the provider snapshot but are not required
      // for an authoritative model inventory, so either may degrade to an empty list.
      let agents: ReadonlyArray<Agent> = [];
      if (agentsResult._tag === "Success" && agentsResult.value.code === 0) {
        agents = parseAgentListCliOutput(agentsResult.value.stdout);
      }
      let skills: ReadonlyArray<OpenCodeSkill> = [];
      if (skillsResult._tag === "Success" && skillsResult.value.code === 0) {
        skills = parseSkillsCliOutput(skillsResult.value.stdout);
      }

      return {
        providerList: { all: allProviders, connected },
        agents,
        skills,
      };
    });

  const loadSkillsFromCli: OpenCodeRuntimeShape["loadSkillsFromCli"] = (input) =>
    runOpenCodeCommand({
      binaryPath: input.binaryPath,
      args: ["debug", "skill"],
      cwd: input.cwd,
      maxOutputBytes: OPENCODE_SKILL_DISCOVERY_MAX_OUTPUT_BYTES,
      ...(input.environment !== undefined ? { environment: input.environment } : {}),
    }).pipe(
      Effect.flatMap((result) =>
        result.code === 0
          ? Effect.succeed(parseSkillsCliOutput(result.stdout))
          : Effect.fail(
              new OpenCodeRuntimeError({
                operation: "loadSkillsFromCli",
                detail: `OpenCode skills command exited with code ${result.code}.`,
              }),
            ),
      ),
    );

  return {
    startOpenCodeServerProcess,
    connectToOpenCodeServer,
    runOpenCodeCommand,
    createOpenCodeSdkClient,
    loadOpenCodeInventory,
    loadOpenCodeSkills,
    loadOpenCodeInventoryV2,
    loadOpenCodeSkillsV2,
    loadInventoryFromCli,
    loadSkillsFromCli,
  } satisfies OpenCodeRuntimeShape;
});

export class OpenCodeRuntime extends Context.Service<OpenCodeRuntime, OpenCodeRuntimeShape>()(
  "t3/provider/opencodeRuntime",
) {}

export const OpenCodeRuntimeLive = Layer.effect(OpenCodeRuntime, makeOpenCodeRuntime).pipe(
  Layer.provide(NetService.layer),
);
