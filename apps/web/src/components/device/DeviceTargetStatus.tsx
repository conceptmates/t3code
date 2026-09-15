import type { DeviceSummary, ScopedThreadRef } from "@t3tools/contracts";
import { Check, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { deviceEnvironment, useDeviceState } from "~/state/device";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { AndroidPairingDialog, androidPairingHosts } from "./AndroidPairingDialog";

const deviceKey = (device: Pick<DeviceSummary, "hostId" | "id">) => `${device.hostId} ${device.id}`;

/**
 * The device this thread targets, in the corner a floating device preview would
 * otherwise occupy. Choosing one opens the thread's device session, the same
 * session the Device panel and the agent device tools work against.
 */
export function DeviceTargetStatus(props: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = props.threadRef;
  const { state } = useDeviceState(environmentId);
  const open = useAtomCommand(deviceEnvironment.open, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);

  const session = state.sessions.find((entry) => entry.threadId === threadId);
  const target = session
    ? state.devices.find(
        (device) => device.hostId === session.hostId && device.id === session.deviceId,
      )
    : undefined;
  const devices = useMemo(
    () =>
      state.devices.toSorted(
        (left, right) =>
          Number(right.booted) - Number(left.booted) ||
          left.platform.localeCompare(right.platform) ||
          left.name.localeCompare(right.name),
      ),
    [state.devices],
  );
  const pairingHosts = useMemo(() => androidPairingHosts(state.hosts), [state.hosts]);

  if (state.hostStatus === "disabled" || devices.length === 0) return null;

  const select = async (device: DeviceSummary) => {
    setPending(true);
    try {
      const result = await open({
        environmentId,
        input: { threadId, hostId: device.hostId, deviceId: device.id, platform: device.platform },
      });
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: `Could not select ${device.name}`,
          description: formatEnvironmentQueryError(result.cause),
        });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="compact"
              variant="ghost-muted"
              aria-label="Target device"
              className="fixed right-3 bottom-3 z-40 max-w-56 rounded-full border bg-background/95 shadow-sm max-sm:hidden"
            />
          }
        >
          {pending ? <Spinner className="size-3.5" /> : <Smartphone />}
          <span className="truncate">{target?.name ?? "No device"}</span>
        </MenuTrigger>
        <MenuPopup align="end" side="top" className="max-w-72">
          {devices.map((device) => (
            <MenuItem key={deviceKey(device)} onClick={() => void select(device)}>
              <span className="min-w-0 flex-1 truncate">
                {device.name}
                <span className="text-muted-foreground">
                  {" "}
                  {device.booted ? "Running" : "Stopped"}
                </span>
              </span>
              {target && deviceKey(target) === deviceKey(device) ? <Check /> : null}
            </MenuItem>
          ))}
          {pairingHosts.length > 0 ? (
            <MenuItem onClick={() => setPairingOpen(true)}>Pair phone over Wi-Fi</MenuItem>
          ) : null}
          {target ? (
            <MenuItem
              onClick={() =>
                useRightPanelStore.getState().openDevice(props.threadRef, {
                  hostId: target.hostId,
                  deviceId: target.id,
                  platform: target.platform,
                  name: target.name,
                })
              }
            >
              Open device panel
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
      {pairingOpen ? (
        <AndroidPairingDialog
          environmentId={environmentId}
          hosts={pairingHosts}
          onClose={() => setPairingOpen(false)}
        />
      ) : null}
    </>
  );
}
