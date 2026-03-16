import { describe, expect, it, vi } from "vitest";
import { addPackageDuration, calculateRemainingDays } from "./time.js";

describe("time helpers", () => {
  it("adds package duration in months", () => {
    const endAt = addPackageDuration(new Date("2026-03-13T00:00:00.000Z"), "3m");
    expect(endAt.toISOString()).toContain("2026-06");
  });

  it("calculates remaining days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T00:00:00.000Z"));
    expect(calculateRemainingDays("2026-03-15T00:00:00.000Z")).toBe(2);
    vi.useRealTimers();
  });
});

