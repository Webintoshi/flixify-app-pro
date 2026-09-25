import assert from 'node:assert/strict';
import { test } from 'node:test';
import { referralView } from './referral-view.ts';

test('progress repeats for every three approved friends without changing the reward rule', () => {
  assert.deepEqual(referralView({ qualified: 2, towardNext: 2, earnedMonths: 0, pendingRewards: 0, invited: 4, history: [] }), {
    approved: 2,
    invited: 4,
    earnedMonths: 0,
    pendingRewards: 0,
    progress: 2,
    remaining: 1,
    history: []
  });
  assert.equal(referralView({ qualified: 6, towardNext: 0, earnedMonths: 2, pendingRewards: 0, invited: 6, history: [] }).remaining, 3);
});

test('older API responses remain readable while history is deployed', () => {
  const view = referralView({ qualified: 0, towardNext: 0, earnedMonths: 0, pendingRewards: 0 });
  assert.equal(view.invited, 0);
  assert.deepEqual(view.history, []);
});
