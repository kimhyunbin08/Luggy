import { query } from '../db/pool.js';
let cachedPolicy = null;
export async function getActivePolicy() {
    if (cachedPolicy)
        return cachedPolicy;
    const result = await query('SELECT * FROM policy_versions WHERE active = true ORDER BY created_at DESC LIMIT 1');
    if (result.rows.length === 0) {
        throw new Error('No active policy version found');
    }
    const row = result.rows[0];
    cachedPolicy = {
        id: row.id,
        versionNumber: row.version_number,
        dailyPriceCarryOn: Number(row.daily_price_carry_on),
        dailyPriceMedium: Number(row.daily_price_medium),
        depositCarryOn: Number(row.deposit_carry_on),
        depositMedium: Number(row.deposit_medium),
        roundTripShipping: Number(row.round_trip_shipping),
        minRentalDays: row.min_rental_days,
        refundFullHours: row.refund_full_hours,
        refundHalfHours: row.refund_half_hours,
        platformFeePercent: Number(row.platform_fee_percent),
        createdAt: new Date(row.created_at),
        active: row.active,
    };
    return cachedPolicy;
}
export async function getPolicyById(policyVersionId) {
    const result = await query('SELECT * FROM policy_versions WHERE id = $1', [policyVersionId]);
    if (result.rows.length === 0) {
        throw new Error(`Policy version not found: ${policyVersionId}`);
    }
    const row = result.rows[0];
    return {
        id: row.id,
        versionNumber: row.version_number,
        dailyPriceCarryOn: Number(row.daily_price_carry_on),
        dailyPriceMedium: Number(row.daily_price_medium),
        depositCarryOn: Number(row.deposit_carry_on),
        depositMedium: Number(row.deposit_medium),
        roundTripShipping: Number(row.round_trip_shipping),
        minRentalDays: row.min_rental_days,
        refundFullHours: row.refund_full_hours,
        refundHalfHours: row.refund_half_hours,
        platformFeePercent: Number(row.platform_fee_percent),
        createdAt: new Date(row.created_at),
        active: row.active,
    };
}
export function calculateRentalDays(startDate, endDate) {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.ceil((endDate.getTime() - startDate.getTime()) / oneDay);
}
export function calculateDailyRate(size, policy) {
    return size === 'carry_on' ? policy.dailyPriceCarryOn : policy.dailyPriceMedium;
}
export function calculateTotalPrice(size, startDate, endDate, policy) {
    const rentalDays = calculateRentalDays(startDate, endDate);
    const dailyRate = calculateDailyRate(size, policy);
    const rentalCost = rentalDays * dailyRate;
    return rentalCost + policy.roundTripShipping;
}
export function calculateRefund(totalPrice, cancellationTime, bookingCreatedAt, policy) {
    const hoursElapsed = (cancellationTime.getTime() - bookingCreatedAt.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed <= policy.refundFullHours) {
        return totalPrice;
    }
    else if (hoursElapsed <= policy.refundHalfHours) {
        return Math.floor(totalPrice * 0.5);
    }
    else {
        return 0;
    }
}
export function calculateSettlement(grossAmount, policy) {
    const platformFee = (grossAmount * policy.platformFeePercent) / 100;
    const providerPayout = grossAmount - platformFee;
    return { platformFee, providerPayout };
}
export function getDepositAmount(size, policy) {
    return size === 'carry_on' ? policy.depositCarryOn : policy.depositMedium;
}
