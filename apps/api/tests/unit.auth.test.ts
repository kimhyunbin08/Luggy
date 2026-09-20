import { describe, expect, it } from 'vitest';
import { generateSessionToken, isValidCarrierPurchaseYear, isValidName, isValidNickname, isValidPhone, isValidTravelDaysPerYear, normalizePhone } from '../src/domain/auth.js';

describe('auth: normalizePhone', () => {
  it('formats an 11-digit phone number into 010-XXXX-XXXX', () => {
    expect(normalizePhone('01012345678')).toBe('010-1234-5678');
  });

  it('leaves an already-hyphenated phone number untouched', () => {
    expect(normalizePhone('010-1234-5678')).toBe('010-1234-5678');
  });

  it('formats a 10-digit phone number into 010-XXX-XXXX', () => {
    expect(normalizePhone('0101234567')).toBe('010-123-4567');
  });
});

describe('auth: isValidPhone', () => {
  it('accepts valid 010 phone numbers with or without hyphens', () => {
    expect(isValidPhone('010-1234-5678')).toBe(true);
    expect(isValidPhone('01012345678')).toBe(true);
  });

  it('rejects malformed phone numbers', () => {
    expect(isValidPhone('02-1234-5678')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});

describe('auth: isValidNickname', () => {
  it('accepts nicknames between 2 and 20 characters', () => {
    expect(isValidNickname('역삼동이웃')).toBe(true);
  });

  it('rejects nicknames that are too short or too long', () => {
    expect(isValidNickname('a')).toBe(false);
    expect(isValidNickname('a'.repeat(21))).toBe(false);
    expect(isValidNickname('   ')).toBe(false);
  });
});

describe('auth: isValidName', () => {
  it('accepts real names between 2 and 20 characters', () => {
    expect(isValidName('김철수')).toBe(true);
  });

  it('rejects names that are too short or too long', () => {
    expect(isValidName('a')).toBe(false);
    expect(isValidName('a'.repeat(21))).toBe(false);
    expect(isValidName('   ')).toBe(false);
  });
});

describe('auth: isValidTravelDaysPerYear', () => {
  it('accepts whole-day counts within a single year', () => {
    expect(isValidTravelDaysPerYear(0)).toBe(true);
    expect(isValidTravelDaysPerYear(30)).toBe(true);
    expect(isValidTravelDaysPerYear(365)).toBe(true);
  });

  it('rejects negative, non-integer, or out-of-range day counts', () => {
    expect(isValidTravelDaysPerYear(-1)).toBe(false);
    expect(isValidTravelDaysPerYear(366)).toBe(false);
    expect(isValidTravelDaysPerYear(1.5)).toBe(false);
  });
});

describe('auth: isValidCarrierPurchaseYear', () => {
  it('accepts a real, non-future year no earlier than 1990', () => {
    expect(isValidCarrierPurchaseYear(1990)).toBe(true);
    expect(isValidCarrierPurchaseYear(new Date().getFullYear())).toBe(true);
  });

  it('rejects years before 1990, future years, or non-integers', () => {
    expect(isValidCarrierPurchaseYear(1989)).toBe(false);
    expect(isValidCarrierPurchaseYear(new Date().getFullYear() + 1)).toBe(false);
    expect(isValidCarrierPurchaseYear(2020.5)).toBe(false);
  });
});

describe('auth: generateSessionToken', () => {
  it('generates unique, non-empty session tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});
