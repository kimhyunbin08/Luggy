import { describe, expect, it } from 'vitest';
import { calculateDepreciation, calculateRefundAmount, calculateSettlement, calculateTotalPrice, validateMinimumRentalDays } from '../src/domain/calculators.js';
import { defaultPolicy } from '../src/domain/policy.js';
describe('unit: policy calculators', () => {
    it('calculates total price with daily price + shipping', () => {
        const total = calculateTotalPrice('carry_on', new Date('2026-08-10'), new Date('2026-08-12'), defaultPolicy);
        expect(total).toBe(29800);
    });
    it('rejects rental under 2 days', () => {
        const ok = validateMinimumRentalDays(new Date('2026-08-10'), new Date('2026-08-11'), defaultPolicy);
        expect(ok).toBe(false);
    });
    it('calculates refund tier', () => {
        expect(calculateRefundAmount(50000, 50, defaultPolicy)).toBe(50000);
        expect(calculateRefundAmount(50000, 30, defaultPolicy)).toBe(25000);
        expect(calculateRefundAmount(50000, 10, defaultPolicy)).toBe(0);
    });
    it('calculates settlement split 80/20', () => {
        expect(calculateSettlement(100000, defaultPolicy)).toEqual({ platformAmount: 80000, providerAmount: 20000 });
    });
    it('applies 2% monthly depreciation with 30% floor', () => {
        expect(calculateDepreciation(100000, 10)).toBe(80000);
        expect(calculateDepreciation(100000, 40)).toBe(30000);
    });
});
