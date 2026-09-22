// Lightweight, dependency-free auth helpers for the C2C direct-contact MVP.
// PG/card payments remain out of scope, but login now requires a password
// (in addition to the phone-number identifier) so that knowing/guessing a
// neighbor's phone number alone can no longer be used to take over their
// account (see prd.md §5/§19, trd.md §16 for the account/data rules).

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PHONE_PATTERN = /^01[0-9]-?\d{3,4}-?\d{4}$/;
// At least 8 characters, containing at least one letter and one digit.
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
const SCRYPT_KEY_LENGTH = 64;

export function normalizePhone(rawPhone: string): string {
  const digits = rawPhone.replace(/[^0-9]/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return rawPhone;
}

export function isValidPhone(rawPhone: string): boolean {
  return PHONE_PATTERN.test(rawPhone.trim());
}

export function isValidNickname(nickname: string): boolean {
  const trimmed = nickname.trim();
  return trimmed.length >= 2 && trimmed.length <= 20;
}

// Real name, collected separately from the public-facing nickname/username
// used in listings, chat, and reviews. Same length bounds as nickname.
export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 20;
}

export function generateSessionToken(): string {
  // Cryptographically random opaque token (not guessable like Math.random()),
  // sufficient for an in-memory MVP session store.
  return `sess_${randomBytes(24).toString('hex')}`;
}

// Password requirement: 8~64 characters, at least one letter and one digit.
export function isValidPassword(password: string): boolean {
  return PASSWORD_PATTERN.test(password);
}

// Salted scrypt hash, stored as "saltHex:hashHex". No external dependency
// (bcrypt/argon2) is required since Node's built-in crypto module already
// provides a memory-hard KDF suitable for password storage.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

// Constant-time comparison against a stored "saltHex:hashHex" value.
export function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// Onboarding step 2: neighborhood address, in the "구 동" style used
// throughout the app (e.g. carrier.district = "강남구 역삼동"), so the
// personalized "동네" badge can reuse the exact same format as listings.
export function isValidDistrict(rawDistrict: string): boolean {
  const trimmed = rawDistrict.trim();
  return trimmed.length >= 2 && trimmed.length <= 30;
}

// Onboarding step 3: "1년에 여행/출장으로 캐리어를 사용하는 날은 며칠인가요?"
// Must be a whole number of days within a single year - rejects negative
// values (e.g. -1) and values that exceed the number of days in a year.
export function isValidTravelDaysPerYear(days: number): boolean {
  return Number.isInteger(days) && days >= 0 && days <= 365;
}

// Onboarding step 3: carrier purchase year. Must be a real, non-future year
// no earlier than 1990 (modern hardshell/softshell carriers predate this by
// a wide margin, so this is a generous but still sane lower bound).
export function isValidCarrierPurchaseYear(year: number): boolean {
  const currentYear = new Date().getFullYear();
  return Number.isInteger(year) && year >= 1990 && year <= currentYear;
}
