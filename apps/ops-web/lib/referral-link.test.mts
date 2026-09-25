import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReferralUrl, readReferralCode } from './referral-link.ts';

test('share links contain only a separate referral code', () => {
  assert.equal(buildReferralUrl('https://flixify.vip', 'ABCDEFGHJKLM'), 'https://flixify.vip/kayit-ol?ref=ABCDEFGHJKLM');
});

test('registration accepts a valid invite and ignores account-login codes', () => {
  assert.equal(readReferralCode('?ref=ABCDEFGHJKLM'), 'ABCDEFGHJKLM');
  assert.equal(readReferralCode('?ref=ABCD1234EFGH5678'), null);
  assert.equal(readReferralCode('?ref=../../admin'), null);
});
