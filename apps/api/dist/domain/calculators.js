export function rentalDays(startDate, endDate) {
    const ms = endDate.getTime() - startDate.getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
export function validateMinimumRentalDays(startDate, endDate, policy) {
    return rentalDays(startDate, endDate) >= policy.minRentalDays;
}
export function calculateTotalPrice(size, startDate, endDate, policy) {
    const days = rentalDays(startDate, endDate);
    return days * policy.dailyPrice[size] + policy.roundTripShippingFee;
}
export function calculateRefundRate(hoursBeforePickup, policy) {
    if (hoursBeforePickup >= 48)
        return 1;
    if (hoursBeforePickup >= 24)
        return 0.5;
    return 0;
}
export function calculateRefundAmount(paidAmount, hoursBeforePickup, policy) {
    return Math.round(paidAmount * calculateRefundRate(hoursBeforePickup, policy));
}
export function calculateSettlement(totalPaid, policy) {
    const platformAmount = Math.round(totalPaid * policy.settlementShare.platform);
    const providerAmount = totalPaid - platformAmount;
    return { platformAmount, providerAmount };
}
export function calculateDepreciation(originalValue, months) {
    const residualFloor = Math.round(originalValue * 0.3);
    const depreciated = Math.round(originalValue * (1 - 0.02 * months));
    return Math.max(depreciated, residualFloor);
}
