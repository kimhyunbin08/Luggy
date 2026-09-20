// Lightweight, dependency-free auth helpers for the C2C direct-contact MVP.
// No PG/password flow is required (out of scope): login is a simple
// phone-number based identity check, matching a "당근마켓" style neighbor
// verification rather than a bank-grade auth system.

const PHONE_PATTERN = /^01[0-9]-?\d{3,4}-?\d{4}$/;

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

export function generateSessionToken(): string {
  // Simple opaque token; sufficient for an in-memory MVP session store.
  return `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
