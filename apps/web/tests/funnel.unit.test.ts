import { describe, expect, it } from 'vitest';
import { collectCheckoutDropoffEvents, shouldDisableBookingCTA } from '../src/funnel.js';

describe('web unit', () => {
  it('collects checkout step dropoff event', () => {
    expect(collectCheckoutDropoffEvents(1)).toEqual(['checkout_step1']);
    expect(collectCheckoutDropoffEvents(2)).toEqual(['checkout_step2']);
    expect(collectCheckoutDropoffEvents(3)).toEqual(['checkout_step3']);
  });

  it('disables CTA when remaining quantity is zero', () => {
    expect(shouldDisableBookingCTA(0)).toBe(true);
    expect(shouldDisableBookingCTA(2)).toBe(false);
  });
});
