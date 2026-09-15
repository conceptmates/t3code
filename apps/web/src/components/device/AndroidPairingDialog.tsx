import type { DeviceAdbPairInput, DeviceHostSummary, EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";

import { deviceEnvironment } from "~/state/device";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { QRCodeSvg } from "../ui/qr-code";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  type AndroidQrPairing,
  androidQrPairingPayload,
  createAndroidQrPairing,
  isAdbAddress,
  isPairingCode,
} from "./androidPairing.logic";

/** Hosts whose adb can pair a phone. */
export const androidPairingHosts = (hosts: ReadonlyArray<DeviceHostSummary>) =>
  hosts.filter((host) =>
    host.platforms.some((platform) => platform.platform === "android" && platform.available),
  );

type PairingStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly label: string }
  | { readonly kind: "failed"; readonly message: string };

export function AndroidPairingDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly hosts: ReadonlyArray<DeviceHostSummary>;
  readonly onClose: () => void;
}) {
  const pair = useAtomCommand(deviceEnvironment.adbPair, { reportFailure: false });
  const [hostId, setHostId] = useState(props.hosts[0]?.id);
  const [method, setMethod] = useState<"qr" | "code">("qr");
  const [qrPairing, setQrPairing] = useState<AndroidQrPairing | null>(null);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<PairingStatus>({ kind: "idle" });
  // The server keeps waiting after the user closes the dialog or moves on, so only
  // the latest request may update it.
  const requestRef = useRef(0);
  const pending = status.kind === "pending";
  const host = props.hosts.find((candidate) => candidate.id === hostId);

  const close = () => {
    requestRef.current++;
    props.onClose();
  };

  const abandonRequest = () => {
    requestRef.current++;
    setStatus({ kind: "idle" });
  };

  const submit = async (input: DeviceAdbPairInput, label: string) => {
    const request = ++requestRef.current;
    setStatus({ kind: "pending", label });
    const result = await pair({ environmentId: props.environmentId, input });
    if (request !== requestRef.current) return;
    if (result._tag === "Failure") {
      setStatus({ kind: "failed", message: formatEnvironmentQueryError(result.cause) });
      return;
    }
    toastManager.add({
      type: "success",
      title: result.value.serial ? "Phone connected" : "Phone paired",
      description: result.value.serial
        ? `${result.value.serial} is ready in the Device panel.`
        : "Reconnect with the IP address and port from the phone's Wireless debugging screen.",
    });
    close();
  };

  const startQrPairing = () => {
    const next = createAndroidQrPairing();
    setQrPairing(next);
    void submit(
      { hostId, method: "qr", serviceName: next.serviceName, password: next.password },
      "Waiting for the phone to scan…",
    );
  };

  const trimmedAddress = address.trim();
  const trimmedCode = code.trim();
  const codeReady =
    isAdbAddress(trimmedAddress) && (trimmedCode === "" || isPairingCode(trimmedCode));

  const submitCode = () => {
    if (!codeReady) return;
    void (trimmedCode
      ? submit({ hostId, method: "code", address: trimmedAddress, code: trimmedCode }, "Pairing…")
      : submit({ hostId, method: "connect", address: trimmedAddress }, "Connecting…"));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Pair Android phone</DialogTitle>
          <DialogDescription>
            On the phone, open Developer options → Wireless debugging. It must be on the same
            network as {host?.kind === "ssh" ? host.label : "this machine"}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {props.hosts.length > 1 ? (
            <div className="space-y-1.5 text-sm">
              <span>Device host</span>
              <Select
                value={hostId}
                onValueChange={(value) => {
                  if (typeof value !== "string") return;
                  abandonRequest();
                  setHostId(value);
                }}
              >
                <SelectTrigger size="sm" className="w-full" aria-label="Device host">
                  <SelectValue>{host?.label}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {props.hosts.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
          <ToggleGroup
            aria-label="Pairing method"
            value={[method]}
            onValueChange={(value) => {
              const next = value[0];
              if (next !== "qr" && next !== "code") return;
              abandonRequest();
              setMethod(next);
            }}
          >
            <Toggle value="qr">QR code</Toggle>
            <Toggle value="code">Pairing code</Toggle>
          </ToggleGroup>
          {method === "qr" ? (
            qrPairing ? (
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-xl border border-border/60 bg-white p-3">
                  <QRCodeSvg
                    value={androidQrPairingPayload(qrPairing)}
                    size={176}
                    level="M"
                    marginSize={2}
                    title="Wireless debugging pairing QR code"
                  />
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Choose Pair device with QR code on the phone and scan this.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Show a code, then choose Pair device with QR code on the phone and scan it.
              </p>
            )
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitCode();
              }}
            >
              <label className="block space-y-1.5 text-sm">
                <span>IP address and port</span>
                <Input
                  autoFocus
                  value={address}
                  disabled={pending}
                  placeholder="192.168.1.20:37215"
                  onChange={(event) => setAddress(event.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span>Wi-Fi pairing code</span>
                <Input
                  value={code}
                  disabled={pending}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Leave empty to reconnect a paired phone"
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <button type="submit" hidden />
            </form>
          )}
          {status.kind === "pending" ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-3.5" />
              {status.label}
            </p>
          ) : null}
          {status.kind === "failed" ? (
            <p role="alert" className="text-sm text-destructive">
              {status.message}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          {method === "qr" ? (
            <Button onClick={startQrPairing}>{qrPairing ? "New code" : "Show QR code"}</Button>
          ) : (
            <Button disabled={pending || !codeReady} onClick={submitCode}>
              {trimmedCode ? "Pair" : "Connect"}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
