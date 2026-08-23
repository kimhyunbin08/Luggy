import { query } from '../db/pool.js';
import { Payment } from '../models/types.js';
import { v4 as uuidv4 } from 'uuid';
import * as bookingService from './booking.service.js';
import * as carrierService from './carrier.service.js';
import * as policyService from './policy.service.js';
import * as ledgerService from './ledger.service.js';
import { signPayload, verifySignature, WebhookSignatureError } from './webhook.service.js';
import { recordWebhookEventOnce } from './webhook-store.service.js';

// No real payment gateway is integrated in this MVP (by explicit product
// decision). Instead, a mock provider signs its own webhook events with the
// same HMAC scheme a real provider (Toss/Stripe/이니시스 등) would use, and
// those events are pushed through the exact same verification + handler code
// path (`processPaymentWebhook`) that a real inbound `/webhooks/payments`
// call uses. This keeps the signed-webhook architecture fully real and
// testable while requiring no external network call or credentials.
export const PAYMENT_WEBHOOK_SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET || 'dev-payment-webhook-secret-change-me';

if (process.env.NODE_ENV !== 'test' && !process.env.PAYMENT_WEBHOOK_SECRET) {
  console.warn(
    '[payment.service] PAYMENT_WEBHOOK_SECRET is not set; using an insecure development default.'
  );
}

type PaymentEventType = 'payment.authorized' | 'payment.completed' | 'payment.failed';

interface PaymentWebhookPayload {
  eventId: string;
  type: PaymentEventType;
  bookingId: string;
  paymentIntentId: string;
}

function mapRow(row: any): Payment {
  return {
    id: row.id,
    bookingId: row.booking_id,
    amount: Number(row.amount),
    depositAmount: row.deposit_amount !== null ? Number(row.deposit_amount) : undefined,
    status: row.status,
    paymentMethod: row.payment_method,
    provider: row.provider,
    paymentIntentId: row.payment_intent_id,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function getPaymentByBooking(bookingId: string): Promise<Payment | null> {
  const result = await query('SELECT * FROM payments WHERE booking_id = $1', [bookingId]);
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

async function upsertPayment(
  bookingId: string,
  amount: number,
  depositAmount: number | undefined,
  status: Payment['status'],
  paymentIntentId: string
): Promise<Payment> {
  const idempotencyKey = `authorize:${bookingId}`;
  const result = await query(
    `INSERT INTO payments
       (id, booking_id, amount, deposit_amount, status, payment_method, provider, payment_intent_id, idempotency_key, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'mock', $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (idempotency_key)
     DO UPDATE SET status = EXCLUDED.status, payment_intent_id = EXCLUDED.payment_intent_id, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [uuidv4(), bookingId, amount, depositAmount ?? null, status, 'mock_card', paymentIntentId, idempotencyKey]
  );
  return mapRow(result.rows[0]);
}

/**
 * Verifies and applies a signed payment webhook event. This is the single
 * code path used both by the internal mock-provider loop
 * (authorizeAndConfirmMockPayment) and by the public POST /webhooks/payments
 * route, so signature verification and business-effect logic are never
 * duplicated or allowed to drift apart.
 */
export async function processPaymentWebhook(
  rawBody: string,
  signatureHeader: string | undefined
): Promise<{ deduped: boolean; type?: PaymentEventType }> {
  if (!verifySignature(PAYMENT_WEBHOOK_SECRET, rawBody, signatureHeader)) {
    throw new WebhookSignatureError();
  }

  const event = JSON.parse(rawBody) as PaymentWebhookPayload;
  const { eventId, type, bookingId, paymentIntentId } = event;

  const isNew = await recordWebhookEventOnce(eventId, 'payment', type, bookingId, event);
  if (!isNew) {
    return { deduped: true };
  }

  const booking = await bookingService.getBookingById(bookingId);
  if (!booking) {
    throw new Error(`Booking not found for payment webhook: ${bookingId}`);
  }

  // Amount/deposit are never trusted from the webhook payload itself — they
  // are re-derived from the booking's own frozen policy_version snapshot, so
  // a webhook can never be used to charge/settle a different amount than
  // what the renter actually agreed to at checkout.
  const carrier = await carrierService.getCarrierById(booking.carrierId);
  const policy = await policyService.getPolicyById(booking.policyVersionId);
  const depositAmount = carrier ? policyService.getDepositAmount(carrier.size, policy) : undefined;

  if (type === 'payment.authorized') {
    await upsertPayment(bookingId, booking.totalPrice, depositAmount, 'authorized', paymentIntentId);
    await ledgerService.recordLedgerEntry({
      bookingId,
      userId: booking.renterId,
      entryType: 'charge',
      amount: booking.totalPrice,
      idempotencyKey: `charge:${bookingId}`,
    });
    if (depositAmount) {
      await ledgerService.recordLedgerEntry({
        bookingId,
        userId: booking.renterId,
        entryType: 'deposit_hold',
        amount: depositAmount,
        idempotencyKey: `deposit_hold:${bookingId}`,
      });
    }
    await bookingService.updateBookingStatus(bookingId, 'payment_authorized');
  } else if (type === 'payment.completed') {
    await upsertPayment(bookingId, booking.totalPrice, depositAmount, 'completed', paymentIntentId);
    await bookingService.updateBookingStatus(bookingId, 'confirmed');
  } else if (type === 'payment.failed') {
    await upsertPayment(bookingId, booking.totalPrice, depositAmount, 'failed', paymentIntentId);
  }

  return { deduped: false, type };
}

/**
 * Drives the full mock-payment lifecycle for a booking: authorize the charge
 * + deposit hold, then confirm/capture — both steps delivered as
 * self-signed webhook events through processPaymentWebhook. Deterministic
 * per-booking event IDs make this safe to call more than once (e.g. a
 * retried /authorize-payment request).
 */
export async function authorizeAndConfirmMockPayment(bookingId: string): Promise<Payment | null> {
  const paymentIntentId = `pi_mock_${bookingId}`;

  const authorizedEvent: PaymentWebhookPayload = {
    eventId: `evt_pay_${bookingId}_authorized`,
    type: 'payment.authorized',
    bookingId,
    paymentIntentId,
  };
  const authorizedSigned = signPayload(PAYMENT_WEBHOOK_SECRET, authorizedEvent);
  await processPaymentWebhook(authorizedSigned.body, authorizedSigned.signatureHeader);

  const completedEvent: PaymentWebhookPayload = {
    eventId: `evt_pay_${bookingId}_completed`,
    type: 'payment.completed',
    bookingId,
    paymentIntentId,
  };
  const completedSigned = signPayload(PAYMENT_WEBHOOK_SECRET, completedEvent);
  await processPaymentWebhook(completedSigned.body, completedSigned.signatureHeader);

  return getPaymentByBooking(bookingId);
}
