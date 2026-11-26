# Devices

Stream and interact with live iOS Simulators, Android Emulators, and physical Android devices right beside a thread, and let agents inspect and drive them via `device_*` tools and the `agent-device` CLI.

## Open a device

Open the right panel in a project thread and choose **Device** (first-time setup starts the device hub, checks iOS/Android tools, and asks whether agents may control devices).

- Start a stopped device or attach to a running one; open additional devices via **+ → Device**.
- Click, drag, and type directly on the live screen; use the toolbar for Home, Back, Recents, rotate, power off, **3D view** (and fold/unfold on foldables), **Tools**, or **Float device over chat**.
- **Tools drawer**: Inspect the foreground app, toggle dark mode, text size, accessibility overlays, mock location, app permissions, iOS VoiceOver / test push notifications, and Android orientation / network toggles.
- Paste text into Android with Cmd+V or Ctrl+V. On Android the toolbar also has volume; hide the toolbar for more room and bring it back from the corner button.
- **Take screenshot** and **Record screen** work on every device. The latest capture appears in the panel corner to preview or save. Recording needs live video, so it is unavailable on the still-image stream.
- On an Android phone, **Turn screen off** darkens the phone while the panel keeps showing it; turn on **Screen off while watching** in **Tools** to do this whenever the phone is showing. The screen comes back on when you close or hide the device.
- Choosing a device in the corner of the chat, or opening one in the panel, makes it the thread's target: agents started afterwards see `ANDROID_SERIAL` and `T3CODE_DEVICE_ID`, so their `adb` commands reach it and a run script can use `flutter run -d "$ANDROID_SERIAL"`.
- Closing a tab stops streaming without powering off the device. Turn off **Settings → Devices → Use devices** to stop helper processes.

## Host prerequisites

Devices run on the environment's server machine (or an SSH/Simlock device host):

- **iOS Simulators**: macOS with Xcode.
- **Android Emulators**: Android SDK Platform-Tools, Android Emulator, Command-line Tools (latest), an AVD created in Android Studio, and `ffmpeg` with `libx264` on `PATH` (or `SERVE_EMU_FFMPEG`). Set `ANDROID_HOME` for custom SDK paths.
- **Physical Android devices**: SDK Platform-Tools only (no `ffmpeg`). Enable **USB debugging** (and **USB debugging (Security settings)** on Xiaomi devices), or pair wirelessly via `adb pair <addr>:<pairing-port>` then `adb connect <addr>:<port>`.
- **Pair a phone over Wi-Fi in T3 Code**: Choose **Pair phone over Wi-Fi** next to **Refresh devices** in the Device panel, or **Pair phone** under **Settings → Devices → Android wireless debugging**. On the phone, open **Developer options → Wireless debugging** and either scan the QR code with **Pair device with QR code** or enter the IP address, port, and code from **Pair device with pairing code**. To reconnect a phone you paired before, enter its IP address and port and leave the code empty. The phone must be on the same network as the device host.

Restart the environment server after installing SDK tools or changing `PATH` / `SERVE_EMU_FFMPEG`.

## Agents and devices

Enable **Settings → Devices → Agents can use devices** so agents can drive devices through `agent-device` (restart existing agent sessions after enabling). First iOS tap builds a small test runner once per server (~2 minutes).

When an agent opens a device, it floats over chat by default (disable **Settings → Browser → Auto-show floating preview** to open in the right panel instead). On mobile, tap the device button above the composer to watch and interact.

## Remote connections

Device video streams through the environment server (works over LAN, Tailscale, and T3 Connect). Live video requires HTTPS or `localhost`—plain HTTP remote origins fall back to still images on iOS and disable video on Android (except Expo Simulators).

## SSH device hosts

Use simulators/emulators on another macOS or Linux machine (e.g., a Mac build host from Linux/Windows):

1. Open **Settings → Devices → Add source → Machine over SSH** and enter an SSH alias or `user@host` (uses the environment server's SSH config/keys; no password prompts).
2. Run **Test connection** to verify SSH, Node.js 22.12+, npm, and SDK tools (Android on SSH hosts requires full SDK tools + `ffmpeg` for emulators).
3. First listing installs pinned device helpers on the SSH host.

> Note: Remote simulators cannot reach `localhost` dev servers (like Metro) on your main host without port forwarding or a reachable network address.

## Simlock hosts (alpha)

Connect to a [Simlock](https://incubator.callstack.com/simlock/) device pool (requires Simlock `main` at commit `6316e10`+ with `capabilities.stream.enabled` and `capabilities.input.enabled`):

1. Enable **Settings → Labs → Simlock device hosts (alpha)** and **Settings → Devices → Use devices**.
2. Choose **Add source → Simlock pool** with an agent token (`simlock --gateway token create --role agent`) over HTTPS or Tailscale (give each T3 server its own token; treat it like worker shell access).
3. Closing a device with **Return device to the pool** wipes and releases the lease. Toolbar tools/rotation/screenshots are unavailable in the UI (agents can still invoke them via `device_open`).

## Device tool updates

The T3 server manages device hub and `agent-device` versions automatically on itself and SSH hosts. Check versions in **Settings → Devices → Check versions**; update the remote T3 server to receive newer device tools.
