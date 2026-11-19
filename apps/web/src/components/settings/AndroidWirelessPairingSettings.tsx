import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { useDeviceState } from "~/state/device";
import { AndroidPairingDialog, androidPairingHosts } from "../device/AndroidPairingDialog";
import { Button } from "../ui/button";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function AndroidWirelessPairingSettings(props: {
  readonly environmentId: EnvironmentId | null;
  readonly disabled: boolean;
}) {
  const { state } = useDeviceState(props.environmentId);
  const [open, setOpen] = useState(false);
  const setting = useSearchableSetting();
  const hosts = androidPairingHosts(state.hosts);
  return (
    <SettingsRow
      {...setting("android-wireless-debugging")}
      description="Pair an Android phone over Wi-Fi so it shows up in the Device panel."
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={props.disabled || !props.environmentId || hosts.length === 0}
          onClick={() => setOpen(true)}
        >
          Pair phone
        </Button>
      }
    >
      {open && props.environmentId ? (
        <AndroidPairingDialog
          environmentId={props.environmentId}
          hosts={hosts}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </SettingsRow>
  );
}
