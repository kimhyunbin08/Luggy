import { query } from '../db/pool.js';
function mapRow(row) {
    return {
        id: row.id,
        bookingId: row.booking_id,
        userId: row.user_id,
        entryType: row.entry_type,
        amount: Number(row.amount),
        idempotencyKey: row.idempotency_key,
        createdAt: new Date(row.created_at),
    };
}
/**
 * Idempotently records a monetary ledger entry. Every money-moving event in the
 * system (charge, refund, deposit hold/release, damage charge) must go through
 * this function with a deterministic idempotency key so retried webhooks or
 * duplicate client calls never double-charge or double-refund.
 */
export async function recordLedgerEntry(input) {
    const result = await query(`INSERT INTO ledger_entries (booking_id, user_id, entry_type, amount, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`, [input.bookingId ?? null, input.userId ?? null, input.entryType, input.amount, input.idempotencyKey]);
    if (result.rows.length > 0) {
        return mapRow(result.rows[0]);
    }
    // Conflict: an entry with this idempotency key already exists. Return it
    // rather than throwing, so callers can safely retry cancel/complete/webhook
    // handlers without side effects.
    const existing = await query('SELECT * FROM ledger_entries WHERE idempotency_key = $1', [
        input.idempotencyKey,
    ]);
    return mapRow(existing.rows[0]);
}
export async function getLedgerEntryByIdempotencyKey(idempotencyKey) {
    const result = await query('SELECT * FROM ledger_entries WHERE idempotency_key = $1', [idempotencyKey]);
    if (result.rows.length === 0)
        return null;
    return mapRow(result.rows[0]);
}
export async function getLedgerEntriesForBooking(bookingId) {
    const result = await query('SELECT * FROM ledger_entries WHERE booking_id = $1 ORDER BY created_at ASC', [bookingId]);
    return result.rows.map(mapRow);
}
