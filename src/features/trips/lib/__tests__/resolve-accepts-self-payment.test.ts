import { describe, expect, test } from 'bun:test';

import { resolveAcceptsSelfPayment } from '../resolve-accepts-self-payment';

describe('resolveAcceptsSelfPayment', () => {
  test('billingTypeValue true → true (family wins)', () => {
    expect(resolveAcceptsSelfPayment(true, false)).toBe(true);
  });

  test('billingTypeValue false → false (family wins)', () => {
    expect(resolveAcceptsSelfPayment(false, true)).toBe(false);
  });

  test('billingTypeValue null, payerValue true → true (payer fallback)', () => {
    expect(resolveAcceptsSelfPayment(null, true)).toBe(true);
  });

  test('billingTypeValue null, payerValue false → false (payer fallback)', () => {
    expect(resolveAcceptsSelfPayment(null, false)).toBe(false);
  });

  test('billingTypeValue undefined, payerValue true → true (no billing_type_id / tier-1 skip)', () => {
    expect(resolveAcceptsSelfPayment(undefined, true)).toBe(true);
  });

  test('billingTypeValue null, payerValue null → null (unconfigured)', () => {
    expect(resolveAcceptsSelfPayment(null, null)).toBeNull();
  });
});
