import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  androidTextChunks,
  createDeviceStreamClient,
  AvccDemuxer,
  avcCodecString,
  parseSemuPacket,
  scanAccessUnit,
} from "./deviceStream";

const envelope = (tag: number, payload: number[]) => {
  const length = 1 + payload.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    tag,
    ...payload,
  ];
};

describe("AvccDemuxer", () => {
  it("reassembles envelopes split across reads", () => {
    const demuxer = new AvccDemuxer();
    const bytes = new Uint8Array([
      ...envelope(1, [1, 0x64, 0x00, 0x1f]),
      ...envelope(2, [9, 9, 9]),
      ...envelope(0x7f, [0]),
      ...envelope(3, [4]),
    ]);
    const first = demuxer.push(bytes.subarray(0, 7));
    const rest = demuxer.push(bytes.subarray(7));
    const chunks = [...first, ...rest];
    expect(chunks.map((chunk) => chunk.type)).toEqual(["description", "keyframe", "delta"]);
    expect(Array.from(chunks[0]!.payload)).toEqual([1, 0x64, 0x00, 0x1f]);
    expect(Array.from(chunks[1]!.payload)).toEqual([9, 9, 9]);
  });

  it("derives the WebCodecs codec string from the avcC record", () => {
    expect(avcCodecString(new Uint8Array([1, 0x64, 0x00, 0x1f]))).toBe("avc1.64001f");
    expect(avcCodecString(new Uint8Array([1]))).toBe("avc1.42E01E");
  });
});

describe("serve-emu frames", () => {
  it("strips the SEMU header and reads the keyframe flag and timestamp", () => {
    const buffer = new ArrayBuffer(16 + 3);
    const view = new DataView(buffer);
    view.setUint32(0, 0x53454d55);
    view.setUint8(4, 1);
    view.setUint8(5, 1);
    view.setBigUint64(8, 123456n);
    new Uint8Array(buffer).set([7, 8, 9], 16);
    const packet = parseSemuPacket(buffer);
    expect(packet.isKey).toBe(true);
    expect(packet.timestamp).toBe(123456);
    expect(Array.from(packet.data)).toEqual([7, 8, 9]);
  });

  it("treats a frame without the header as raw data", () => {
    const packet = parseSemuPacket(new Uint8Array([0, 0, 1, 0x65]).buffer);
    expect(packet.isKey).toBeNull();
    expect(packet.data.length).toBe(4);
  });

  it("finds the SPS and IDR NAL units in an Annex-B access unit", () => {
    const unit = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0, 0, 1, 0x65, 0xaa]);
    const scanned = scanAccessUnit(unit);
    expect(scanned.isKey).toBe(true);
    expect(scanned.sps && avcCodecString(scanned.sps)).toBe("avc1.64001f");
    expect(scanAccessUnit(new Uint8Array([0, 0, 1, 0x41, 0x00])).isKey).toBe(false);
  });
});

describe("iOS input startup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const setup = () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      binaryType = "";
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      send = vi.fn();
      close = vi.fn();
      constructor() {
        sockets.push(this);
      }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: RequestInit) => {
        const signal = init.signal!;
        signals.push(signal);
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                signal.addEventListener("abort", () => controller.error(new Error("aborted")));
              },
            }),
          ),
        );
      }),
    );
    const client = createDeviceStreamClient(
      {
        platform: "ios",
        deviceId: "test-device",
        access: {
          httpBase: "http://test/api/device-hub",
          wsBase: "ws://test/api/device-hub",
          credentials: true,
          query: {},
        },
      },
      { getContext: () => null } as unknown as HTMLCanvasElement,
      {
        onStatus: vi.fn(),
        onScreen: vi.fn(),
        onUnauthorized: vi.fn(),
        onMjpegFallback: vi.fn(),
        onInputConnected: vi.fn(),
      },
    );
    return { client, sockets, signals };
  };

  it("connects input when the MJPEG prime never produces a frame", async () => {
    const { client, sockets, signals } = setup();
    client.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(signals[0]?.aborted).toBe(true);
    expect(sockets).toHaveLength(1);
    client.stop();
  });

  it("aborts priming immediately when hidden without opening a socket later", async () => {
    const { client, sockets, signals } = setup();
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(0);
  });

  it.each([
    ["landscape_left", 0.7, 1 - 0.2],
    ["landscape_right", 1 - 0.7, 0.2],
  ])("maps %s touches back to the raw iOS framebuffer", async (orientation, x, y) => {
    const { client, sockets } = setup();
    client.start();
    await vi.advanceTimersByTimeAsync(2_000);
    const socket = sockets[0]!;
    const json = new TextEncoder().encode(JSON.stringify({ width: 400, height: 800, orientation }));
    const packet = new Uint8Array(1 + json.length);
    packet[0] = 0x82;
    packet.set(json, 1);
    socket.onmessage?.({ data: packet.buffer });
    client.sendTouch("begin", 0.2, 0.7);
    const sent = socket.send.mock.calls[0]![0] as Uint8Array;
    expect(JSON.parse(new TextDecoder().decode(sent.subarray(1)))).toEqual({
      type: "begin",
      x,
      y,
    });
    client.stop();
  });
});

describe("Android paste", () => {
  it("splits text into 300-byte chunks without cutting a multi-byte character", () => {
    const text = `${"a".repeat(299)}é${"b".repeat(10)}`;
    const chunks = [...androidTextChunks(text)];
    expect(chunks.map((chunk) => new TextEncoder().encode(chunk).length)).toEqual([299, 12]);
    expect(chunks.join("")).toBe(text);
  });
});

describe("Android video startup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // serve-emu frame: "SEMU", version 1, key flag, 8-byte pts at offset 8, then Annex-B NAL units.
  const semuPacket = (key: boolean) => {
    const annexB = key
      ? [0, 0, 0, 1, 0x67, 0x42, 0x80, 0x0a, 0, 0, 0, 1, 0x65, 0x88]
      : [0, 0, 0, 1, 0x41, 0x9a];
    const bytes = new Uint8Array(16 + annexB.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x53454d55);
    view.setUint8(4, 1);
    view.setUint8(5, key ? 1 : 0);
    bytes.set(annexB, 16);
    return bytes.buffer;
  };
  const session = (width: number, height: number) =>
    JSON.stringify({ type: "video-session", size: { width, height } });

  const setup = () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      binaryType = "";
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: ArrayBuffer | string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      send = vi.fn();
      close = vi.fn();
      constructor() {
        sockets.push(this);
      }
    }
    const support: Array<(result: { supported: boolean }) => void> = [];
    const decoded: string[] = [];
    let decoders = 0;
    class FakeVideoDecoder {
      static isConfigSupported = () =>
        new Promise<{ supported: boolean }>((resolve) => {
          support.push(resolve);
        });
      state = "unconfigured";
      decodeQueueSize = 0;
      constructor() {
        decoders++;
      }
      configure() {
        this.state = "configured";
      }
      decode(chunk: { type: string }) {
        decoded.push(chunk.type);
      }
      close() {
        this.state = "closed";
      }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("VideoDecoder", FakeVideoDecoder);
    vi.stubGlobal(
      "EncodedVideoChunk",
      class {
        readonly type: string;
        constructor(init: { type: string }) {
          this.type = init.type;
        }
      },
    );
    const client = createDeviceStreamClient(
      {
        platform: "android",
        deviceId: "phone",
        access: {
          httpBase: "http://test/api/device-hub",
          wsBase: "ws://test/api/device-hub",
          credentials: true,
          query: {},
        },
      },
      { getContext: () => null } as unknown as HTMLCanvasElement,
      {
        onStatus: vi.fn(),
        onScreen: vi.fn(),
        onUnauthorized: vi.fn(),
        onMjpegFallback: vi.fn(),
        onInputConnected: vi.fn(),
      },
    );
    client.start();
    const socket = sockets[0]!;
    socket.onopen?.();
    return {
      client,
      support,
      decoded,
      decoders: () => decoders,
      receive: (data: ArrayBuffer | string) => socket.onmessage?.({ data }),
      // On scrcpy each keyframe request restarts the session for every viewer.
      keyframeRequests: () =>
        socket.send.mock.calls
          .flat()
          .map(String)
          .filter((sent) => sent.includes("reset-video")).length,
    };
  };

  it("decodes the keyframe that configured the decoder instead of restarting the phone's session", async () => {
    const stream = setup();
    stream.receive(session(576, 1280));
    stream.receive(semuPacket(true));
    // Arrives while the decoder is still being configured.
    stream.receive(semuPacket(false));
    stream.support[0]!({ supported: true });

    await vi.waitFor(() => expect(stream.decoded).toEqual(["key", "delta"]));
    expect(stream.keyframeRequests()).toBe(0);
    stream.client.stop();
  });

  it("keeps the decoder through a same-size session restart", async () => {
    const stream = setup();
    stream.receive(session(576, 1280));
    stream.receive(semuPacket(true));
    stream.support[0]!({ supported: true });
    await vi.waitFor(() => expect(stream.decoded).toEqual(["key"]));

    // Another viewer asked for a keyframe, so the session restarts at the same size.
    stream.receive(session(576, 1280));
    stream.receive(semuPacket(false));
    stream.receive(semuPacket(true));
    stream.receive(semuPacket(false));

    expect(stream.decoded).toEqual(["key", "key", "delta"]);
    expect(stream.decoders()).toBe(1);
    expect(stream.keyframeRequests()).toBe(0);
    stream.client.stop();
  });

  it("rebuilds the decoder after rotation and asks for one keyframe at a time", async () => {
    const stream = setup();
    stream.receive(session(576, 1280));
    stream.receive(semuPacket(true));
    stream.support[0]!({ supported: true });
    await vi.waitFor(() => expect(stream.decoded).toEqual(["key"]));

    stream.receive(session(1280, 576));
    stream.receive(semuPacket(false));
    stream.receive(semuPacket(false));
    expect(stream.keyframeRequests()).toBe(1);

    stream.receive(semuPacket(true));
    stream.support[1]!({ supported: true });
    await vi.waitFor(() => expect(stream.decoded).toEqual(["key", "key"]));
    expect(stream.decoders()).toBe(2);
    stream.client.stop();
  });
});
