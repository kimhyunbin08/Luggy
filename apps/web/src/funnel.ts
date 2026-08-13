export type FunnelStep = 'checkout_step1' | 'checkout_step2' | 'checkout_step3';

export function collectCheckoutDropoffEvents(currentStep: 1 | 2 | 3): FunnelStep[] {
  if (currentStep === 1) return ['checkout_step1'];
  if (currentStep === 2) return ['checkout_step2'];
  return ['checkout_step3'];
}

export function shouldDisableBookingCTA(remainingQuantity: number): boolean {
  return remainingQuantity <= 0;
}
