export type CarrierSize = 'carry_on' | 'medium';

export type PolicyVersion = {
  id: string;
  minRentalDays: number;
  dailyPrice: Record<CarrierSize, number>;
  roundTripShippingFee: number;
  deposit: Record<CarrierSize, number>;
  refundRules: { hoursBefore: number; rate: number }[];
  settlementShare: { platform: number; provider: number };
};

export const defaultPolicy: PolicyVersion = {
  id: 'v1',
  minRentalDays: 2,
  dailyPrice: { carry_on: 7900, medium: 11900 },
  roundTripShippingFee: 14000,
  deposit: { carry_on: 30000, medium: 50000 },
  refundRules: [
    { hoursBefore: 48, rate: 1 },
    { hoursBefore: 24, rate: 0.5 },
    { hoursBefore: 0, rate: 0 }
  ],
  settlementShare: { platform: 0.8, provider: 0.2 }
};
