import { describe, expect, it } from 'vitest';
import { generateSessionToken, isValidNickname, isValidPhone, normalizePhone } from '../src/domain/auth.js';

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

describe('auth: generateSessionToken', () => {
  it('generates unique, non-empty session tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});
