// Shared HMAC signing/verification helpers used by the mock payment provider
// and the delivery webhook simulator. No real payment gateway is integrated in
// this MVP, but the signed-webhook mechanism itself (sign -> transmit -> verify
// -> idempotent apply) is fully implemented so the architecture matches what a
// real provider integration would require later.
import crypto from 'node:crypto';

export interface SignedPayload {
  body: string;
  signatureHeader: string;
}

/**
 * Signs a JSON-serializable payload using the Stripe-style
 * `t=<timestamp>,v1=<hmac>` scheme over `${timestamp}.${body}`.
 */
export function signPayload(secret: string, payload: unknown): SignedPayload {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { body, signatureHeader: `t=${timestamp},v1=${signature}` };
}

/**
 * Verifies a signature header against the raw request body. Uses a
 * constant-time comparison and rejects stale signatures to reduce replay risk.
 */
export function verifySignature(
  secret: string,
  body: string,
  signatureHeader: string | undefined | null,
  toleranceSeconds = 300
): boolean {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((entry) => {
      const idx = entry.indexOf('=');
      return [entry.slice(0, idx), entry.slice(idx + 1)];
    })
  );

  const timestamp = Number(parts.t);
  const providedSignature = parts.v1;
  if (!timestamp || !providedSignature) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expectedSignature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const providedBuffer = Buffer.from(providedSignature, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export class WebhookSignatureError extends Error {
  statusCode = 401;
  constructor(message = 'Invalid or missing webhook signature') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}
