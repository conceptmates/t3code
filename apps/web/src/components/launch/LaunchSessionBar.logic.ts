/**
 * The launch bar's horizontal position is a fraction of the free space in its
 * container: 0 is flush left, 1 is flush right. Rendering it as
 * `left: f%; translateX(-f%)` keeps the bar inside the container at any width
 * without measuring on resize.
 */
export const DEFAULT_LAUNCH_BAR_POSITION = 0.5;

export function clampLaunchBarPosition(position: number): number {
  if (!Number.isFinite(position)) return DEFAULT_LAUNCH_BAR_POSITION;
  return Math.min(1, Math.max(0, position));
}

/** Position after dragging the bar `deltaX` pixels from where the drag started. */
export function dragLaunchBarPosition(input: {
  readonly startPosition: number;
  readonly deltaX: number;
  readonly containerWidth: number;
  readonly barWidth: number;
}): number {
  const freeSpace = input.containerWidth - input.barWidth;
  if (freeSpace <= 0) return clampLaunchBarPosition(input.startPosition);
  return clampLaunchBarPosition(input.startPosition + input.deltaX / freeSpace);
}
