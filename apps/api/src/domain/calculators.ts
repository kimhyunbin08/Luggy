import { CarrierSize, PolicyVersion } from './policy.js';

export function rentalDays(startDate: Date, endDate: Date): number {
  const ms = endDate.getTime() - startDate.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function validateMinimumRentalDays(startDate: Date, endDate: Date, policy: PolicyVersion): boolean {
  return rentalDays(startDate, endDate) >= policy.minRentalDays;
}

export function calculateTotalPrice(size: CarrierSize, startDate: Date, endDate: Date, policy: PolicyVersion): number {
  const days = rentalDays(startDate, endDate);
  return days * policy.dailyPrice[size] + policy.roundTripShippingFee;
}

export function calculateRefundRate(hoursBeforePickup: number, policy: PolicyVersion): number {
  if (hoursBeforePickup >= 48) return 1;
  if (hoursBeforePickup >= 24) return 0.5;
  return 0;
}

export function calculateRefundAmount(paidAmount: number, hoursBeforePickup: number, policy: PolicyVersion): number {
  return Math.round(paidAmount * calculateRefundRate(hoursBeforePickup, policy));
}

export function calculateSettlement(totalPaid: number, policy: PolicyVersion): { platformAmount: number; providerAmount: number } {
  const platformAmount = Math.round(totalPaid * policy.settlementShare.platform);
  const providerAmount = totalPaid - platformAmount;
  return { platformAmount, providerAmount };
}

export function calculateDepreciation(originalValue: number, months: number): number {
  const residualFloor = Math.round(originalValue * 0.3);
  const depreciated = Math.round(originalValue * (1 - 0.02 * months));
  return Math.max(depreciated, residualFloor);
}
