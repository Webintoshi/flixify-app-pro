import type { PackageDuration } from "@flixify/contracts";

const monthMap: Record<PackageDuration, number> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "12m": 12
};

export function addPackageDuration(startAt: Date, duration: PackageDuration) {
  const endAt = new Date(startAt);
  endAt.setMonth(endAt.getMonth() + monthMap[duration]);
  return endAt;
}

export function calculateRemainingDays(endAt: string | Date) {
  const end = typeof endAt === "string" ? new Date(endAt) : endAt;
  const diffMs = end.getTime() - Date.now();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

