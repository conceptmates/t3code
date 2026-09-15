import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { pairAndroidDevice, parseAdbMdnsServices } from "./AndroidWirelessPairing.ts";
import type { DeviceHostReady } from "./DeviceHost.ts";

const services = (...lines: ReadonlyArray<string>) =>
  ["List of discovered mdns services", ...lines, ""].join("\n");

const PHONE_SERVICES = services(
  "adb-432366c2-ZkyJ16 (2)\t_adb-tls-connect._tcp\t192.168.1.50:42519",
  "t3code-abc\t_adb-tls-pairing._tcp.\t192.168.1.50:37001",
);

const fakeAdb = (respond: (args: ReadonlyArray<string>) => { stdout?: string; code?: number }) => {
  const calls: Array<ReadonlyArray<string>> = [];
  const run: DeviceHostReady["run"] = (command, args) => {
    calls.push([command, ...args]);
    const result = respond(args);
    return Effect.succeed({ stdout: result.stdout ?? "", stderr: "", code: result.code ?? 0 });
  };
  return { run, calls };
};

describe("parseAdbMdnsServices", () => {
  it("reads instance names with spaces and service types with or without the trailing dot", () => {
    expect(parseAdbMdnsServices(PHONE_SERVICES)).toEqual([
      { name: "adb-432366c2-ZkyJ16 (2)", kind: "connect", address: "192.168.1.50:42519" },
      { name: "t3code-abc", kind: "pairing", address: "192.168.1.50:37001" },
    ]);
  });
});

describe("pairAndroidDevice", () => {
  it.effect("pairs through the QR service name, then connects to that phone's debugging port", () =>
    Effect.gen(function* () {
      const { run, calls } = fakeAdb((args) =>
        args[0] === "mdns"
          ? { stdout: PHONE_SERVICES }
          : args[0] === "pair"
            ? { stdout: "Successfully paired to 192.168.1.50:37001 [guid=adb-432366c2-ZkyJ16]" }
            : { stdout: "connected to 192.168.1.50:42519" },
      );
      const serial = yield* pairAndroidDevice(run, {
        method: "qr",
        serviceName: "t3code-abc",
        password: "secret1234",
      });
      expect(serial).toBe("192.168.1.50:42519");
      expect(calls).toEqual([
        ["adb", "mdns", "services"],
        ["adb", "pair", "192.168.1.50:37001", "secret1234"],
        ["adb", "mdns", "services"],
        ["adb", "connect", "192.168.1.50:42519"],
      ]);
    }),
  );

  it.effect("reports a rejected pairing code with adb's reason and does not connect", () =>
    Effect.gen(function* () {
      const { run, calls } = fakeAdb(() => ({
        stdout: "Failed: Wrong password or connection was dropped.",
        code: 1,
      }));
      const error = yield* pairAndroidDevice(run, {
        method: "code",
        address: "192.168.1.50:37001",
        code: "123456",
      }).pipe(Effect.flip);
      expect(error.reason).toBe("pair_failed");
      expect(error.message).toContain("Wrong password");
      expect(calls).toEqual([["adb", "pair", "192.168.1.50:37001", "123456"]]);
    }),
  );

  it.effect("treats adb's exit-code-0 connect failure as an error", () =>
    Effect.gen(function* () {
      const { run } = fakeAdb(() => ({
        stdout: "failed to connect to '192.168.1.50:9': Operation timed out",
      }));
      const error = yield* pairAndroidDevice(run, {
        method: "connect",
        address: "192.168.1.50:9",
      }).pipe(Effect.flip);
      expect(error.reason).toBe("connect_failed");
    }),
  );

  it.effect("gives up when the phone never advertises the QR pairing service", () =>
    Effect.gen(function* () {
      const { run, calls } = fakeAdb(() => ({ stdout: services() }));
      const error = yield* pairAndroidDevice(
        run,
        { method: "qr", serviceName: "t3code-abc", password: "secret1234" },
        { pairing: 1, connect: 1 },
      ).pipe(Effect.flip);
      expect(error.reason).toBe("not_found");
      expect(calls).toEqual([["adb", "mdns", "services"]]);
    }),
  );
});
