import { DesktopTouchBarIconsSchema, DesktopTouchBarStateSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopTouchBar from "../../window/DesktopTouchBar.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const setTouchBarState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.TOUCH_BAR_SET_STATE_CHANNEL,
  payload: Schema.NullOr(DesktopTouchBarStateSchema),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.touchBar.setState")(function* (state) {
    const touchBar = yield* DesktopTouchBar.DesktopTouchBar;
    yield* touchBar.apply(state);
  }),
});

export const setTouchBarIcons = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.TOUCH_BAR_SET_ICONS_CHANNEL,
  payload: DesktopTouchBarIconsSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.touchBar.setIcons")(function* (icons) {
    const touchBar = yield* DesktopTouchBar.DesktopTouchBar;
    yield* touchBar.setIcons(icons);
  }),
});
