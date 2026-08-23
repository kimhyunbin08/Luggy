import { query } from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';
import * as bookingService from './booking.service.js';
import * as policyService from './policy.service.js';
import * as ledgerService from './ledger.service.js';
import { signPayload, verifySignature, WebhookSignatureError } from './webhook.service.js';
import { recordWebhookEventOnce } from './webhook-store.service.js';
// Separate secret from the payment webhook so a leak of one does not
// compromise the other; simulates an independent carrier/logistics partner.
export const DELIVERY_WEBHOOK_SECRET = process.env.DELIVERY_WEBHOOK_SECRET || 'dev-delivery-webhook-secret-change-me';
if (process.env.NODE_ENV !== 'test' && !process.env.DELIVERY_WEBHOOK_SECRET) {
    console.warn('[delivery.service] DELIVERY_WEBHOOK_SECRET is not set; using an insecure development default.');
}
function mapRow(row) {
    return {
        id: row.id,
        bookingId: row.booking_id,
        direction: row.direction,
        status: row.status,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}
export async function getDeliveryTimeline(bookingId) {
    const result = await query('SELECT * FROM delivery_orders WHERE booking_id = $1 ORDER BY created_at ASC', [bookingId]);
    return result.rows.map(mapRow);
}
/**
 * Verifies and applies a signed delivery-carrier webhook event, mirroring
 * processPaymentWebhook's shape. Handles the required "당일 미도착 시 배송비
 * 100% 환불" delay-compensation rule: an outbound delivery marked 'delayed'
 * idempotently records a full round-trip-shipping refund ledger entry.
 */
export async function processDeliveryWebhook(rawBody, signatureHeader) {
    if (!verifySignature(DELIVERY_WEBHOOK_SECRET, rawBody, signatureHeader)) {
        throw new WebhookSignatureError();
    }
    const event = JSON.parse(rawBody);
    const { eventId, bookingId, direction, status } = event;
    const isNew = await recordWebhookEventOnce(eventId, 'delivery', `${direction}.${status}`, bookingId, event);
    if (!isNew) {
        return { deduped: true };
    }
    const booking = await bookingService.getBookingById(bookingId);
    if (!booking) {
        throw new Error(`Booking not found for delivery webhook: ${bookingId}`);
    }
    await query(`INSERT INTO delivery_orders (id, booking_id, direction, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [uuidv4(), bookingId, direction, status]);
    await bookingService.updateDeliveryStatus(bookingId, status);
    if (direction === 'outbound') {
        if (status === 'in_transit') {
            await bookingService.updateBookingStatus(bookingId, 'outbound_in_transit');
        }
        else if (status === 'arrived') {
            await bookingService.updateBookingStatus(bookingId, 'in_use');
        }
        else if (status === 'delayed') {
            const policy = await policyService.getPolicyById(booking.policyVersionId);
            await ledgerService.recordLedgerEntry({
                bookingId,
                userId: booking.renterId,
                entryType: 'refund',
                amount: policy.roundTripShipping,
                idempotencyKey: `delay_comp:${bookingId}`,
            });
        }
    }
    else if (direction === 'return') {
        if (status === 'in_transit') {
            await bookingService.updateBookingStatus(bookingId, 'return_in_transit');
        }
        else if (status === 'arrived') {
            await bookingService.updateBookingStatus(bookingId, 'inspection_pending');
        }
    }
    return { deduped: false };
}
/**
 * Simulates a carrier delivery event for local/demo/E2E use (no real
 * logistics integration exists). Self-signs the event with the same secret
 * the public /webhooks/delivery route verifies against, so it exercises the
 * real signature-verification path rather than bypassing it.
 */
export async function simulateDeliveryEvent(bookingId, direction, status) {
    const event = {
        eventId: `evt_delivery_${bookingId}_${direction}_${status}_${Date.now()}`,
        bookingId,
        direction,
        status,
    };
    const signed = signPayload(DELIVERY_WEBHOOK_SECRET, event);
    return processDeliveryWebhook(signed.body, signed.signatureHeader);
}
