import { query } from '../db/pool.js';
/**
 * Records a verified webhook event for audit/dedup purposes. Returns true if
 * this is the first time we've seen this event_id (i.e. the caller should
 * process it), false if it's a duplicate delivery that was already recorded
 * (caller should treat it as a no-op success, per standard webhook semantics).
 */
export async function recordWebhookEventOnce(eventId, source, eventType, bookingId, payload) {
    const result = await query(`INSERT INTO webhook_events (event_id, source, event_type, booking_id, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`, [eventId, source, eventType, bookingId ?? null, JSON.stringify(payload)]);
    return result.rows.length > 0;
}
