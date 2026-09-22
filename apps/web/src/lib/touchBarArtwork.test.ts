import { describe, expect, it } from "vite-plus/test";

import { providerAccentColor, providerIconKey, providerRowKey, rowSvg } from "./touchBarArtwork";

const row = (overrides: Partial<Parameters<typeof rowSvg>[0]> = {}) =>
  rowSvg({
    driverKind: "claudeAgent",
    accentColor: "#d97757",
    selected: true,
    windows: [
      { caption: "5h", usedPercent: 62, countdown: "2h 13m" },
      { caption: "Wk", usedPercent: 31, countdown: null },
    ],
    ...overrides,
  });

describe("providerAccentColor", () => {
  it("uses the icon's own dark-appearance fill, since the strip is always dark", () => {
    expect(providerAccentColor("claudeAgent")).toBe("#d97757");
    expect(providerAccentColor("codex")).toBe("#ffffff");
  });

  it("prefers a colour the user set on the instance", () => {
    expect(providerAccentColor("claudeAgent", "#123456")).toBe("#123456");
  });

  it("falls back to a neutral for a driver it has no artwork for", () => {
    expect(providerAccentColor("antigravity")).toBe("#8e8e93");
  });
});

describe("artwork keys", () => {
  it("keys glyphs by driver and rows by instance, so two Claude accounts differ", () => {
    expect(providerIconKey("claudeAgent")).toBe("provider:claudeAgent");
    expect(providerRowKey("claude_work")).toBe("row:claude_work");
  });
});

describe("rowSvg", () => {
  it("draws one track and one fill per quota window", () => {
    const svg = row();
    // Two tracks plus two fills, both windows being above zero.
    expect(svg.match(/<rect/g)?.length).toBe(5);
    expect(svg).toContain("62%");
    expect(svg).toContain("31%");
    expect(svg).toContain("2h 13m");
  });

  it("fills the bar in the provider's accent", () => {
    expect(row()).toContain('fill="#d97757"');
  });

  it("warns in red once a window is nearly spent", () => {
    const svg = row({ windows: [{ caption: "5h", usedPercent: 94, countdown: null }] });
    expect(svg).toContain("#ff6961");
    expect(svg).not.toContain('rx="2" fill="#d97757"');
  });

  it("omits the fill entirely at zero rather than drawing a stub", () => {
    const svg = row({
      selected: false,
      windows: [{ caption: "5h", usedPercent: 0, countdown: null }],
    });
    expect(svg.match(/<rect/g)?.length).toBe(1);
  });

  it("marks the active provider with a leading accent rule", () => {
    expect(row({ selected: true })).toContain('<rect x="0" y="6" width="3"');
    expect(row({ selected: false })).not.toContain('<rect x="0" y="6" width="3"');
  });

  it("renders at 2x for the Touch Bar's display", () => {
    expect(row()).toMatch(/height="60" viewBox="0 0 \d+ 30"/);
  });

  it("escapes text rather than letting it break the markup", () => {
    const svg = row({ windows: [{ caption: "a<b&c", usedPercent: 10, countdown: null }] });
    expect(svg).toContain("a&lt;b&amp;c");
    expect(svg).not.toContain("a<b&c");
  });
});
