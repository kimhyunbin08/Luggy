// Minimal email/password auth for the '동네 직거래(P2P Direct Deal)' flow.
//
// The legacy platform-delivery flow never needed real accounts (it runs on
// two seeded demo users, MOCK_RENTER_ID/MOCK_PROVIDER_ID — see
// scripts/init-db.ts) because every transaction was platform-mediated and
// nobody needed to be told apart. Direct-deal chat between two strangers
// does need that, so this adds just enough auth to make requester/owner
// identity real, without pulling in a JWT/bcrypt dependency: password
// hashing uses node:crypto scrypt, and session tokens are HMAC-signed the
// same way the payment/delivery webhook signatures already are
// (see webhook.service.ts).
import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { User } from '../models/types.js';

export const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'dev-auth-token-secret-change-me';

if (process.env.NODE_ENV !== 'test' && !process.env.AUTH_TOKEN_SECRET) {
  // eslint-disable-next-line no-console
  console.warn('[auth.service] AUTH_TOKEN_SECRET is not set; using an insecure development default.');
}

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export class AuthError extends Error {
  statusCode = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

function mapRowToUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone ?? undefined,
    role: row.role,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ---- Password hashing (scrypt, no external dependency) --------------------
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// ---- Session tokens (HMAC-signed payload, same style as
// webhook.service.ts's signPayload/verifySignature) -------------------------
interface TokenPayload {
  sub: string; // user id
  iat: number;
  exp: number;
}

export function signToken(userId: string): string {
  const payload: TokenPayload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_TOKEN_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

/** Returns the user id encoded in a valid, unexpired token, or null. */
export function verifyToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expectedSignature = crypto.createHmac('sha256', AUTH_TOKEN_SECRET).update(payloadB64).digest('base64url');
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== providedBuffer.length) return null;
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) return null;

  try {
    const payload: TokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

// ---- User lookups / signup / login ----------------------------------------
export async function findUserByEmail(email: string): Promise<(User & { passwordHash: string | null }) | null> {
  const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { ...mapRowToUser(row), passwordHash: row.password_hash };
}

export async function findUserById(id: string): Promise<User | null> {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return mapRowToUser(result.rows[0]);
}

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  phone?: string;
}

export async function signup(input: SignupInput): Promise<User> {
  const email = input.email.toLowerCase().trim();
  const existing = await findUserByEmail(email);
  if (existing) {
    throw new Error('EMAIL_TAKEN');
  }
  const passwordHash = hashPassword(input.password);
  // role is a legacy column kept for the platform-delivery flow; in direct-deal
  // mode a single account both lists carriers and sends requests, so it's
  // stored as an informational default and never used to gate access here.
  const result = await query(
    `INSERT INTO users (email, name, phone, role, password_hash)
     VALUES ($1, $2, $3, 'renter', $4)
     RETURNING *`,
    [email, input.name, input.phone || null, passwordHash]
  );
  return mapRowToUser(result.rows[0]);
}

export async function login(email: string, password: string): Promise<User> {
  const user = await findUserByEmail(email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    throw new AuthError('Invalid email or password');
  }
  const { passwordHash: _drop, ...rest } = user;
  return rest;
}
