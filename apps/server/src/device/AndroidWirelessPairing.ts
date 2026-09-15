/**
 * Android wireless debugging pairing through the device host's adb.
 *
 * Pairing and debugging are separate services on the phone, each on its own
 * port. After pairing, the phone advertises its debugging service over mDNS,
 * so the host looks that address up instead of asking for a second one. QR
 * pairing works the same way, except the phone advertises the pairing service
 * under the name encoded in the QR code, which is the only way to learn its port.
 *
 * adb reports most connect failures on stdout with exit code 0, so results are
 * read from the text. `adb pair` can hang on a wrong address, so every call has
 * a timeout.
 */
import { DeviceAdbPairingError, type DeviceAdbPairInput } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type { DeviceHostReady } from "./DeviceHost.ts";

type Runner = DeviceHostReady["run"];
type RunResult = Effect.Success<ReturnType<Runner>>;

const ADB_TIMEOUT_MS = 20_000;
const POLL_INTERVAL = Duration.seconds(1);

export interface AdbMdnsService {
  readonly name: string;
  readonly kind: "pairing" | "connect";
  readonly address: string;
}

/** Parses `adb mdns services`: tab-separated instance name, service type, and address. */
export const parseAdbMdnsServices = (stdout: string): ReadonlyArray<AdbMdnsService> =>
  stdout.split(/\r?\n/).flatMap((line) => {
    const [name, type, address] = line.split("\t").map((part) => part.trim());
    if (!name || !type || !address) return [];
    const kind: AdbMdnsService["kind"] | null = type.startsWith("_adb-tls-pairing")
      ? "pairing"
      : type.startsWith("_adb-tls-connect")
        ? "connect"
        : null;
    return kind ? [{ name, kind, address }] : [];
  });

const hostOf = (address: string) => address.slice(0, address.lastIndexOf(":"));

const pairingError = (reason: DeviceAdbPairingError["reason"], result?: RunResult) => {
  const detail = result
    ? (result.stdout.trim() || result.stderr.trim()).split(/\r?\n/).at(-1)?.trim()
    : undefined;
  return new DeviceAdbPairingError({ reason, ...(detail ? { detail } : {}) });
};

const waitForService = Effect.fn("AndroidWirelessPairing.waitForService")(function* (
  run: Runner,
  matches: (service: AdbMdnsService) => boolean,
  attempts: number,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) yield* Effect.sleep(POLL_INTERVAL);
    const result = yield* run("adb", ["mdns", "services"], { timeoutMs: ADB_TIMEOUT_MS });
    const service = parseAdbMdnsServices(result.stdout).find(matches);
    if (service) return service;
  }
  return null;
});

const connect = Effect.fn("AndroidWirelessPairing.connect")(function* (
  run: Runner,
  address: string,
) {
  const result = yield* run("adb", ["connect", address], { timeoutMs: ADB_TIMEOUT_MS });
  if (result.code !== 0 || !/^(already )?connected to /m.test(result.stdout)) {
    return yield* pairingError("connect_failed", result);
  }
  return address;
});

/**
 * Pairs or connects one phone. Resolves with the adb serial it connected as,
 * or null when pairing worked but the phone never advertised a debugging port.
 */
export const pairAndroidDevice = Effect.fn("AndroidWirelessPairing.pair")(function* (
  run: Runner,
  input: DeviceAdbPairInput,
  attempts: { readonly pairing: number; readonly connect: number } = { pairing: 120, connect: 20 },
) {
  if (input.method === "connect") return yield* connect(run, input.address);

  let pairAddress = input.method === "code" ? input.address : null;
  if (input.method === "qr") {
    const service = yield* waitForService(
      run,
      (candidate) => candidate.kind === "pairing" && candidate.name === input.serviceName,
      attempts.pairing,
    );
    if (!service) return yield* pairingError("not_found");
    pairAddress = service.address;
  }
  if (!pairAddress) return yield* pairingError("not_found");

  const secret = input.method === "qr" ? input.password : input.code;
  const paired = yield* run("adb", ["pair", pairAddress, secret], { timeoutMs: ADB_TIMEOUT_MS });
  if (paired.code !== 0 || !/Successfully paired/i.test(paired.stdout)) {
    return yield* pairingError("pair_failed", paired);
  }

  const phone = hostOf(pairAddress);
  const debugging = yield* waitForService(
    run,
    (candidate) => candidate.kind === "connect" && hostOf(candidate.address) === phone,
    attempts.connect,
  );
  return debugging ? yield* connect(run, debugging.address) : null;
});
