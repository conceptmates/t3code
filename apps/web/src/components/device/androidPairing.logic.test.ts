import { describe, expect, it } from "vite-plus/test";

import {
  androidQrPairingPayload,
  createAndroidQrPairing,
  isAdbAddress,
  isPairingCode,
} from "./androidPairing.logic";

describe("Android wireless pairing", () => {
  it("encodes Android's ADB QR format with a name and password the server accepts", () => {
    const pairing = createAndroidQrPairing();
    expect(pairing.serviceName).toMatch(/^t3code-[a-z0-9]{8}$/);
    expect(pairing.password).toMatch(/^[a-z0-9]{12}$/);
    expect(androidQrPairingPayload({ serviceName: "t3code-abc", password: "p4ss" })).toBe(
      "WIFI:T:ADB;S:t3code-abc;P:p4ss;;",
    );
  });

  it("accepts host:port addresses and six-digit codes, and rejects flag-like input", () => {
    expect(isAdbAddress("192.168.1.20:37215")).toBe(true);
    expect(isAdbAddress("192.168.1.20")).toBe(false);
    expect(isAdbAddress("-L:1")).toBe(false);
    expect(isPairingCode("123456")).toBe(true);
    expect(isPairingCode("12345")).toBe(false);
  });
});
