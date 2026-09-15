import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_LAUNCH_BAR_POSITION,
  clampLaunchBarPosition,
  dragLaunchBarPosition,
} from "./LaunchSessionBar.logic";

describe("dragLaunchBarPosition", () => {
  it("moves by the dragged share of the free space", () => {
    expect(
      dragLaunchBarPosition({
        startPosition: 0.5,
        deltaX: 100,
        containerWidth: 600,
        barWidth: 200,
      }),
    ).toBe(0.75);
  });

  it("stops at the container edges", () => {
    expect(
      dragLaunchBarPosition({
        startPosition: 0.9,
        deltaX: 400,
        containerWidth: 600,
        barWidth: 200,
      }),
    ).toBe(1);
    expect(
      dragLaunchBarPosition({
        startPosition: 0.1,
        deltaX: -400,
        containerWidth: 600,
        barWidth: 200,
      }),
    ).toBe(0);
  });

  it("keeps the position when the bar fills the container", () => {
    expect(
      dragLaunchBarPosition({ startPosition: 0.3, deltaX: 50, containerWidth: 200, barWidth: 240 }),
    ).toBe(0.3);
  });
});

describe("clampLaunchBarPosition", () => {
  it("recovers from stored values outside the range", () => {
    expect(clampLaunchBarPosition(-2)).toBe(0);
    expect(clampLaunchBarPosition(7)).toBe(1);
    expect(clampLaunchBarPosition(Number.NaN)).toBe(DEFAULT_LAUNCH_BAR_POSITION);
  });
});
