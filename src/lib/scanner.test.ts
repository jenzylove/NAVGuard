import { describe, expect, it } from "vitest";
import { classifyGuardState, selectEffectiveMultiplier } from "./scanner";

describe("multiplier activation", () => {
  it("uses the stored multiplier before activation", () => {
    expect(selectEffectiveMultiplier(1.01, 4.04, 2_000, 1_999)).toBe(1.01);
  });

  it("uses the replacement multiplier at activation", () => {
    expect(selectEffectiveMultiplier(1.01, 4.04, 2_000, 2_000)).toBe(4.04);
  });

  it("flags an activated mismatch as integration risk", () => {
    expect(
      classifyGuardState({
        rawMultiplier: 1,
        effectiveMultiplier: 1.25,
        effectiveTimestamp: 1_000,
        isPaused: false,
        nowSeconds: 5_000,
      }).state,
    ).toBe("AMBER");
  });

  it("blocks a paused mint", () => {
    expect(
      classifyGuardState({
        rawMultiplier: 1,
        effectiveMultiplier: 1,
        effectiveTimestamp: 0,
        isPaused: true,
        nowSeconds: 5_000,
      }).state,
    ).toBe("RED");
  });
});
