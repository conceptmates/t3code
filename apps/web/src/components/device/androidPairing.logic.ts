const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export interface AndroidQrPairing {
  readonly serviceName: string;
  readonly password: string;
}

const randomToken = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) =>
    TOKEN_ALPHABET.charAt(byte % TOKEN_ALPHABET.length),
  ).join("");

/** A fresh service name and password. The phone advertises the name after it scans the code. */
export const createAndroidQrPairing = (): AndroidQrPairing => ({
  serviceName: `t3code-${randomToken(8)}`,
  password: randomToken(12),
});

/** Android's wireless debugging QR format, the same one Android Studio shows. */
export const androidQrPairingPayload = (pairing: AndroidQrPairing) =>
  `WIFI:T:ADB;S:${pairing.serviceName};P:${pairing.password};;`;

/** `host:port`, and never something adb would read as a flag. */
export const isAdbAddress = (value: string) => /^[^\s-]\S*:\d{1,5}$/.test(value.trim());

export const isPairingCode = (value: string) => /^\d{6}$/.test(value.trim());
