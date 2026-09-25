export type ReferralHistory = { status: 'joined' | 'qualified'; joinedAt: string; qualifiedAt: string | null };

export type ReferralSummary = {
  code?: string | null;
  qualified: number;
  towardNext: number;
  earnedMonths: number;
  pendingRewards: number;
  invited?: number;
  history?: ReferralHistory[];
};

export function referralView(summary: ReferralSummary) {
  const progress = summary.towardNext;
  return {
    approved: summary.qualified,
    invited: summary.invited ?? summary.qualified,
    earnedMonths: summary.earnedMonths,
    pendingRewards: summary.pendingRewards,
    progress,
    remaining: 3 - progress,
    history: summary.history ?? []
  };
}
