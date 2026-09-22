import type {
  DevicePlatform,
  DeviceServiceState,
  DeviceSummary,
  ScopedThreadRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  Camera,
  ChevronLeft,
  CircleStop,
  Disc,
  Home,
  Monitor,
  MonitorOff,
  PanelTopClose,
  PanelTopOpen,
  PictureInPicture2,
  Power,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Square,
  Volume1,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore, type RightPanelSurface } from "~/rightPanelStore";
import { Button } from "~/components/ui/button";
import { DiscoveryList, DiscoveryListRow } from "~/components/ui/discovery-list";
import { Dialog } from "~/components/ui/dialog";
import { WizardPopup } from "~/components/ui/wizard";
import { Spinner } from "~/components/ui/spinner";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { deviceEnvironment, useDeviceHubAccess, useDeviceState } from "~/state/device";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { AndroidPairingDialog, androidPairingHosts } from "./AndroidPairingDialog";
import { DeviceCaptureTray, DeviceRecordingBadge, useDeviceCapture } from "./DeviceCapture";
import { DeviceStreamView, type DeviceStreamHandle } from "./DeviceStreamView";
import { DeviceHostUpdates } from "./DeviceHostUpdates";
import { DeviceLoadingView } from "./DeviceLoadingView";
import { DeviceSetup } from "./DeviceSetup";
import { DeviceToolsPanel } from "./DeviceToolsPanel";
import { PreviewPanelShell, type PreviewPanelMode } from "../preview/PreviewPanelShell";

const platformLabel = (platform: DevicePlatform) =>
  platform === "ios" ? "iOS Simulators" : "Android devices";

const DEVICE_TOOLBAR_HIDDEN_STORAGE_KEY = "t3code:device-toolbar-hidden";
const DEVICE_AUTO_SCREEN_OFF_STORAGE_KEY = "t3code:device-auto-screen-off";

const ANDROID_ROTATIONS = [
  "portrait",
  "landscape_left",
  "portrait_upside_down",
  "landscape_right",
] as const;

const deviceKey = (device: Pick<DeviceSummary, "hostId" | "id">) =>
  `${device.hostId}\u0000${device.id}`;

/** Each surface owns one host/device; only the visible surface streams. */
export function DevicePanel(props: {
  readonly mode: PreviewPanelMode;
  readonly threadRef: ScopedThreadRef;
  readonly surface: Extract<RightPanelSurface, { kind: "device" }>;
  readonly visible: boolean;
  readonly onDismissSetup: () => void;
}) {
  const { environmentId, threadId } = props.threadRef;
  const { state, loaded } = useDeviceState(environmentId);
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const open = useAtomCommand(deviceEnvironment.open);
  const close = useAtomCommand(deviceEnvironment.close);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pendingDevice, setPendingDevice] = useState<DeviceSummary | null>(null);
  const pendingDeviceKey = pendingDevice ? deviceKey(pendingDevice) : null;
  const [handle, setHandle] = useState<DeviceStreamHandle | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [axOverlay, setAxOverlay] = useState(false);
  const access = useDeviceHubAccess(environmentId);
  const runAction = useAtomCommand(deviceEnvironment.action, { reportFailure: false });
  const [toolbarHidden, setToolbarHidden] = useLocalStorage(
    DEVICE_TOOLBAR_HIDDEN_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [autoScreenOff, setAutoScreenOff] = useLocalStorage(
    DEVICE_AUTO_SCREEN_OFF_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [screenOffKey, setScreenOffKey] = useState<string | null>(null);
  const [androidRotation, setAndroidRotation] = useState(0);
  const [pairingOpen, setPairingOpen] = useState(false);

  const hostDisabled = state.hostStatus === "disabled";

  // Opening setup never grants permission to install or start helpers.
  useEffect(() => {
    if (!props.visible || !loaded || hostDisabled) return;
    void list({ environmentId, input: {} });
  }, [environmentId, list, loaded, props.visible, hostDisabled]);

  const sessions = useMemo(
    () => state.sessions.filter((session) => session.threadId === threadId),
    [state.sessions, threadId],
  );
  const activeSession = props.surface.target
    ? sessions.find(
        (session) =>
          session.deviceId === props.surface.target?.deviceId &&
          session.hostId === props.surface.target.hostId,
      )
    : undefined;
  const activeDevice = activeSession
    ? state.devices.find(
        (device) => device.hostId === activeSession.hostId && device.id === activeSession.deviceId,
      )
    : undefined;

  const grouped = useMemo(() => groupDevices(state), [state]);
  const pairingHosts = useMemo(() => androidPairingHosts(state.hosts), [state.hosts]);

  const capture = useDeviceCapture({
    access,
    device: activeDevice,
    handle,
    onError: setOperationError,
  });

  // The phone this panel turned dark. It is lit again once it stops showing
  // here, so closing, hiding, or switching the device never strands a dark screen.
  const poweredOffRef = useRef<DeviceSummary | null>(null);
  const applyScreenPower = async (device: DeviceSummary, on: boolean) => {
    const key = deviceKey(device);
    const result = await runAction({
      environmentId,
      input: { hostId: device.hostId, deviceId: device.id, type: "setScreenPower", value: on },
    });
    if (result._tag === "Failure") {
      setOperationError(formatEnvironmentQueryError(result.cause));
      return;
    }
    if (!on) poweredOffRef.current = device;
    else if (poweredOffRef.current && deviceKey(poweredOffRef.current) === key) {
      poweredOffRef.current = null;
    }
    setScreenOffKey((current) => (on ? (current === key ? null : current) : key));
  };
  const restoreScreen = useEffectEvent((device: DeviceSummary) => {
    void applyScreenPower(device, true);
  });
  const shownKey = props.visible && activeDevice ? deviceKey(activeDevice) : null;
  useEffect(() => {
    if (!shownKey) return;
    return () => {
      const device = poweredOffRef.current;
      if (device && deviceKey(device) === shownKey) restoreScreen(device);
    };
  }, [shownKey]);

  const autoScreenOffKey =
    autoScreenOff && props.visible && activeDevice?.platform === "android" && activeDevice.physical
      ? deviceKey(activeDevice)
      : null;
  const darkenForAutoScreenOff = useEffectEvent((key: string) => {
    const device = state.devices.find((candidate) => deviceKey(candidate) === key);
    if (device) void applyScreenPower(device, false);
  });
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Drives the phone over adb; state updates land after the command.
    if (autoScreenOffKey) darkenForAutoScreenOff(autoScreenOffKey);
  }, [autoScreenOffKey]);

  const rotateAndroid = async (device: DeviceSummary) => {
    const next = (androidRotation + 1) % ANDROID_ROTATIONS.length;
    const result = await runAction({
      environmentId,
      input: {
        hostId: device.hostId,
        deviceId: device.id,
        type: "setOrientation",
        value: ANDROID_ROTATIONS[next] ?? "portrait",
      },
    });
    if (result._tag === "Failure") setOperationError(formatEnvironmentQueryError(result.cause));
    else setAndroidRotation(next);
  };

  const selectDevice = async (value: string) => {
    const device = state.devices.find((candidate) => deviceKey(candidate) === value);
    if (!device) return;
    setOperationError(null);
    setPendingDevice(device);
    try {
      const result = await open({
        environmentId,
        input: {
          threadId,
          hostId: device.hostId,
          deviceId: device.id,
          platform: device.platform,
        },
      });
      if (result._tag === "Failure") setOperationError(formatEnvironmentQueryError(result.cause));
      else
        useRightPanelStore.getState().openDevice(props.threadRef, {
          hostId: result.value.hostId,
          deviceId: result.value.deviceId,
          platform: device.platform,
          name: device.name,
        });
    } finally {
      setPendingDevice(null);
    }
  };

  // Floating the device closes the panel, like the browser's floating preview.
  const floatActive = () => {
    if (!activeDevice) return;
    usePreviewMiniPlayerStore.getState().open(props.threadRef, {
      kind: "device",
      hostId: activeDevice.hostId,
      deviceId: activeDevice.id,
      platform: activeDevice.platform,
      name: activeDevice.name,
    });
    useRightPanelStore.getState().close(props.threadRef);
  };

  const closeActive = (powerOff: boolean) => {
    if (!powerOff) {
      useRightPanelStore.getState().closeSurface(props.threadRef, props.surface.id);
      return;
    }
    if (!activeSession) return;
    setOperationError(null);
    void close({
      environmentId,
      input: {
        threadId,
        hostId: activeSession.hostId,
        deviceId: activeSession.deviceId,
        shutdown: powerOff,
      },
    }).then((result) => {
      if (result._tag === "Failure") setOperationError(formatEnvironmentQueryError(result.cause));
      else useRightPanelStore.getState().closeSurface(props.threadRef, props.surface.id);
    });
  };

  const bootingDevices =
    state.bootingDevices?.filter((device) => device.threadId === threadId) ?? [];
  const hostReady = Object.values(state.hostStatuses).some((host) => host.status === "ready");
  const hostBusy =
    !hostReady &&
    Object.values(state.hostStatuses).some(
      (host) => host.status === "installing" || host.status === "starting",
    );
  const unavailablePlatforms = state.hosts.flatMap((host) =>
    host.platforms
      .filter((platform) => !platform.available)
      .map((platform) => ({ ...platform, hostId: host.id, hostLabel: host.label })),
  );

  if (loaded && (!state.onboardingCompleted || hostDisabled)) {
    return (
      <Dialog
        open={props.visible}
        onOpenChange={(isOpen) => {
          if (!isOpen) props.onDismissSetup();
        }}
      >
        <WizardPopup>
          <DeviceSetup environmentId={environmentId} state={state} />
        </WizardPopup>
      </Dialog>
    );
  }

  return (
    <PreviewPanelShell mode={props.mode}>
      {activeDevice && toolbarHidden ? null : (
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {props.surface.target
              ? `${state.hosts.find((host) => host.id === props.surface.target?.hostId)?.label ?? "Device host"} · ${activeDevice?.version ?? props.surface.target.platform}`
              : (pendingDevice?.name ?? "Choose a device")}
          </span>
          {activeDevice ? (
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
              <DeviceButton
                label="Home"
                onClick={() => handle?.pressButton("home")}
                disabled={!handle?.inputConnected}
              >
                <Home />
              </DeviceButton>
              {activeDevice.platform === "android" ? (
                <>
                  <DeviceButton
                    label="Back"
                    onClick={() => handle?.pressButton("back")}
                    disabled={!handle?.inputConnected}
                  >
                    <ChevronLeft />
                  </DeviceButton>
                  <DeviceButton
                    label="Recents"
                    onClick={() => handle?.pressButton("recents")}
                    disabled={!handle?.inputConnected}
                  >
                    <Square />
                  </DeviceButton>
                  <DeviceButton
                    label="Volume down"
                    onClick={() => handle?.pressButton("volumeDown")}
                    disabled={!handle?.inputConnected}
                  >
                    <Volume1 />
                  </DeviceButton>
                  <DeviceButton
                    label="Volume up"
                    onClick={() => handle?.pressButton("volumeUp")}
                    disabled={!handle?.inputConnected}
                  >
                    <Volume2 />
                  </DeviceButton>
                  <DeviceButton label="Rotate" onClick={() => void rotateAndroid(activeDevice)}>
                    <RotateCcw />
                  </DeviceButton>
                  {activeDevice.physical ? (
                    <DeviceButton
                      label={
                        screenOffKey === deviceKey(activeDevice)
                          ? "Turn screen on"
                          : "Turn screen off"
                      }
                      onClick={() =>
                        void applyScreenPower(
                          activeDevice,
                          screenOffKey === deviceKey(activeDevice),
                        )
                      }
                    >
                      {screenOffKey === deviceKey(activeDevice) ? <Monitor /> : <MonitorOff />}
                    </DeviceButton>
                  ) : null}
                </>
              ) : (
                <DeviceButton
                  label="Rotate"
                  onClick={() => handle?.rotate()}
                  disabled={!handle?.inputConnected}
                >
                  <RotateCcw />
                </DeviceButton>
              )}
              <DeviceButton
                label="Take screenshot"
                onClick={() => void capture.takeScreenshot()}
                disabled={capture.capturing}
              >
                <Camera />
              </DeviceButton>
              <DeviceButton
                label={capture.recordingStartedAt === null ? "Record screen" : "Stop recording"}
                onClick={capture.toggleRecording}
                disabled={capture.recordingStartedAt === null && !handle}
              >
                {capture.recordingStartedAt === null ? <Disc /> : <CircleStop />}
              </DeviceButton>
              <Toggle
                aria-label="Tools"
                variant="ghost"
                size="xs"
                pressed={toolsOpen}
                onPressedChange={(pressed) => setToolsOpen(Boolean(pressed))}
              >
                <SlidersHorizontal />
              </Toggle>
              <DeviceButton label="Float device over chat" onClick={floatActive}>
                <PictureInPicture2 />
              </DeviceButton>
              <DeviceButton label="Hide toolbar" onClick={() => setToolbarHidden(true)}>
                <PanelTopClose />
              </DeviceButton>
              <DeviceButton label="Power off" onClick={() => closeActive(true)}>
                <Power />
              </DeviceButton>
              <DeviceButton label="Close" onClick={() => closeActive(false)}>
                <X />
              </DeviceButton>
            </div>
          ) : null}
        </div>
      )}
      {hostReady && state.hostStatusDetail ? (
        <div
          role="status"
          className="whitespace-pre-line border-b px-3 py-2 text-xs text-muted-foreground"
        >
          {state.hostStatusDetail}
        </div>
      ) : null}
      <DeviceHostUpdates state={state} environmentId={environmentId} />
      {bootingDevices.length > 0 ? (
        <div role="status" className="border-b px-3 py-2 text-xs text-muted-foreground">
          Starting {bootingDevices.map((device) => device.name).join(", ")}… This can take a minute.
        </div>
      ) : null}
      {operationError ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{operationError}</p>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Dismiss device error"
            onClick={() => setOperationError(null)}
          >
            <X className="size-3" />
          </Button>
        </div>
      ) : null}
      <div className="@container relative flex min-h-0 flex-1">
        {activeDevice && activeSession ? (
          <>
            <div className="relative min-h-0 min-w-0 flex-1">
              <DeviceStreamView
                key={deviceKey(activeDevice)}
                environmentId={environmentId}
                platform={activeDevice.platform}
                deviceName={activeDevice.name}
                deviceDescription={`${state.hosts.find((host) => host.id === activeDevice.hostId)?.label ?? "Device host"} · ${activeDevice.version}`}
                deviceId={activeDevice.id}
                hostId={activeDevice.hostId}
                visible={props.visible}
                axOverlay={axOverlay}
                onHandle={setHandle}
              />
              {toolbarHidden ? (
                <div className="absolute top-2 right-2 z-10 rounded-md bg-background/80">
                  <DeviceButton label="Show toolbar" onClick={() => setToolbarHidden(false)}>
                    <PanelTopOpen />
                  </DeviceButton>
                </div>
              ) : null}
              {capture.recordingStartedAt !== null ? (
                <DeviceRecordingBadge startedAt={capture.recordingStartedAt} />
              ) : null}
              {capture.latest ? (
                <DeviceCaptureTray capture={capture.latest} onDismiss={capture.dismiss} />
              ) : null}
            </div>
            {toolsOpen ? (
              <DeviceToolsPanel
                key={deviceKey(activeDevice)}
                environmentId={environmentId}
                device={activeDevice}
                access={access}
                axOverlay={axOverlay}
                onAxOverlayChange={setAxOverlay}
                autoScreenOff={autoScreenOff}
                onAutoScreenOffChange={setAutoScreenOff}
                onClose={() => setToolsOpen(false)}
                className="absolute inset-y-0 right-0 z-10 w-full max-w-72 border-l shadow-lg @[560px]:static @[560px]:w-72 @[560px]:shrink-0 @[560px]:shadow-none"
              />
            ) : null}
          </>
        ) : pendingDevice || hostBusy || !loaded ? (
          <DeviceLoadingView
            name={pendingDevice?.name ?? "Devices"}
            description={
              pendingDevice
                ? `${state.hosts.find((host) => host.id === pendingDevice.hostId)?.label ?? "Device host"} · ${pendingDevice.version}`
                : ""
            }
            stage="opening"
            message={
              pendingDevice
                ? pendingDevice.booted
                  ? "Opening device…"
                  : "Starting device…"
                : state.hostStatus === "installing"
                  ? (state.hostStatusDetail ?? "Installing device support…")
                  : "Finding devices…"
            }
          />
        ) : (
          <div className="flex size-full flex-col overflow-y-auto px-5 py-8 text-sm text-muted-foreground">
            <div
              className={cn(
                "mx-auto flex w-full max-w-xl flex-col gap-6",
                grouped.length === 0 && "my-auto items-center text-center",
              )}
            >
              {grouped.length === 0 ? (
                <>
                  <Smartphone className="size-6 opacity-60" />
                  <p className="max-w-sm">
                    {state.hostStatus === "failed"
                      ? (state.hostStatusDetail ?? "The device hub failed to start.")
                      : "No simulators or emulators were found on this environment."}
                  </p>
                </>
              ) : null}
              {hostReady && grouped.length > 0 ? (
                <div className="w-full space-y-6 text-left">
                  {grouped.map((group) => (
                    <section key={group.platform} className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Smartphone className="size-4 shrink-0" />
                        <h3 className="font-medium">{platformLabel(group.platform)}</h3>
                      </div>
                      <DiscoveryList>
                        {group.devices.map((device) => (
                          <DiscoveryListRow
                            key={deviceKey(device)}
                            icon={
                              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/60">
                                <Smartphone className="size-4" />
                              </span>
                            }
                            title={device.name}
                            description={`${state.hosts.find((host) => host.id === device.hostId)?.label} · ${device.version} · ${device.booted ? "Running" : "Stopped"}`}
                            disabled={pendingDeviceKey !== null}
                            aria-label={`${device.booted ? "Open" : "Start"} ${device.name}`}
                            onClick={() => void selectDevice(deviceKey(device))}
                            action={
                              pendingDeviceKey === deviceKey(device) ? (
                                <Spinner className="size-3" />
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {device.booted ? "Open" : "Start"}
                                </span>
                              )
                            }
                          />
                        ))}
                      </DiscoveryList>
                    </section>
                  ))}
                </div>
              ) : null}
              {hostReady &&
              !state.devices.some((device) => device.platform === "android") &&
              !unavailablePlatforms.some((platform) => platform.platform === "android") ? (
                <p className="max-w-sm text-xs">
                  No Android virtual devices found. Create one in Android Studio's Device Manager,
                  then refresh.
                </p>
              ) : null}
              {loaded && !hostBusy ? (
                <div
                  className={
                    grouped.length > 0
                      ? "flex flex-wrap items-center gap-2 self-start"
                      : "flex flex-wrap items-center gap-2 self-center"
                  }
                >
                  <Button
                    variant={grouped.length > 0 ? "ghost" : "outline"}
                    size="sm"
                    onClick={() => void list({ environmentId, input: {} })}
                  >
                    Refresh devices
                  </Button>
                  {pairingHosts.length > 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => setPairingOpen(true)}>
                      Pair phone over Wi-Fi
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
      {pairingOpen ? (
        <AndroidPairingDialog
          environmentId={environmentId}
          hosts={pairingHosts}
          onClose={() => setPairingOpen(false)}
        />
      ) : null}
    </PreviewPanelShell>
  );
}

function DeviceButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.label}
            onClick={props.onClick}
            disabled={props.disabled ?? false}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function groupDevices(state: DeviceServiceState) {
  const groups: Array<{ platform: DevicePlatform; devices: DeviceSummary[] }> = [];
  for (const platform of ["ios", "android"] as const) {
    const devices = state.devices
      .filter((device) => device.platform === platform)
      .toSorted((a, b) => Number(b.booted) - Number(a.booted) || a.name.localeCompare(b.name));
    if (devices.length > 0) groups.push({ platform, devices });
  }
  return groups;
}
