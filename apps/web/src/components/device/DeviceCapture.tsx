import type { DeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import type { DeviceSummary } from "@t3tools/contracts";
import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { downloadMedia } from "../media/mediaContent";
import { fetchDeviceScreenshot } from "./deviceHubApi";
import type { DeviceStreamHandle } from "./DeviceStreamView";

// Chromium records H.264 MP4 directly; other engines fall back to WebM.
const RECORDING_MIME_TYPES = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"];
const RECORDING_FPS = 30;

export interface DeviceCapture {
  readonly kind: "image" | "video";
  readonly url: string;
  readonly name: string;
}

const captureName = (device: DeviceSummary, extension: string) => {
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  return `${device.name.replaceAll(/[^\w.-]+/g, "-")}-${stamp}.${extension}`;
};

/**
 * Screenshots come from the hub at the device's native resolution. Recordings
 * encode the decoded stream canvas in the browser, so they work on every host
 * and connection mode and nothing is stored on the server. Only the latest
 * capture is kept; its object URL is revoked once it is replaced or dropped.
 */
export function useDeviceCapture(input: {
  readonly access: DeviceHubAccess | null;
  readonly device: DeviceSummary | undefined;
  readonly handle: DeviceStreamHandle | null;
  readonly onError: (message: string) => void;
}) {
  const [latest, setLatest] = useState<DeviceCapture | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (!latest) return;
    return () => URL.revokeObjectURL(latest.url);
  }, [latest]);

  // A recording ends with the stream it records. Hiding the panel, switching
  // devices, and leaving the panel all drop the stream handle.
  const streaming = input.handle !== null;
  useEffect(() => {
    if (!streaming) recorderRef.current?.stop();
  }, [streaming]);
  useEffect(() => () => recorderRef.current?.stop(), []);

  const takeScreenshot = async () => {
    const { access, device } = input;
    if (!access || !device) return;
    setCapturing(true);
    try {
      const blob = await fetchDeviceScreenshot({
        access,
        platform: device.platform,
        deviceId: device.id,
      });
      setLatest({
        kind: "image",
        url: URL.createObjectURL(blob),
        name: captureName(device, "png"),
      });
    } catch (error) {
      input.onError(error instanceof Error ? error.message : "The screenshot failed.");
    } finally {
      setCapturing(false);
    }
  };

  const toggleRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    const { device } = input;
    const stream = input.handle?.captureVideo(RECORDING_FPS) ?? null;
    if (!device || !stream) {
      input.onError(
        "Recording needs the live video stream. Try again once the device is streaming.",
      );
      return;
    }
    const mimeType = RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      recorderRef.current = null;
      setRecordingStartedAt(null);
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (blob.size === 0) return;
      const extension = recorder.mimeType.startsWith("video/mp4") ? "mp4" : "webm";
      setLatest({
        kind: "video",
        url: URL.createObjectURL(blob),
        name: captureName(device, extension),
      });
    };
    recorder.start(1_000);
    recorderRef.current = recorder;
    setRecordingStartedAt(Date.now());
  };

  return {
    latest,
    capturing,
    recordingStartedAt,
    takeScreenshot,
    toggleRecording,
    dismiss: () => setLatest(null),
  };
}

/** Elapsed recording time; repaints once a second. */
export function DeviceRecordingBadge(props: { readonly startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - props.startedAt) / 1_000));
  return (
    <div
      role="status"
      aria-label="Recording"
      className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-0.5 font-mono text-xs text-white tabular-nums"
    >
      <span className="size-2 rounded-full bg-destructive" aria-hidden />
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </div>
  );
}

/** The latest capture as a corner thumbnail. Opening it uses the chat media preview. */
export function DeviceCaptureTray(props: {
  readonly capture: DeviceCapture;
  readonly onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { capture } = props;
  const noun = capture.kind === "image" ? "screenshot" : "recording";
  return (
    <>
      <div className="absolute right-3 bottom-3 z-10 flex items-start gap-1">
        <button
          type="button"
          aria-label={`Open ${noun}`}
          className="overflow-hidden rounded-md border border-border bg-black shadow-lg"
          onClick={() => setOpen(true)}
        >
          {capture.kind === "image" ? (
            <img src={capture.url} alt="" className="block h-24 w-auto" />
          ) : (
            <video src={capture.url} muted preload="metadata" className="block h-24 w-auto" />
          )}
        </button>
        <div className="flex flex-col gap-1 rounded-md bg-background/80">
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Save ${noun}`}
            onClick={() => void downloadMedia(capture.url, capture.name)}
          >
            <Download />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Dismiss ${noun}`}
            onClick={props.onDismiss}
          >
            <X />
          </Button>
        </div>
      </div>
      {open ? (
        <ExpandedImageDialog
          preview={{
            index: 0,
            images: [
              {
                src: capture.url,
                name: capture.name,
                ...(capture.kind === "video" ? { type: "video" as const } : {}),
              },
            ],
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
