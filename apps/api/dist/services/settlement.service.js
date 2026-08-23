import { query } from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';
function mapRow(row) {
    return {
        id: row.id,
        providerId: row.provider_id,
        bookingId: row.booking_id,
        grossAmount: Number(row.gross_amount),
        platformFee: Number(row.platform_fee),
        providerPayout: Number(row.provider_payout),
        status: row.status,
        createdAt: new Date(row.created_at),
        paidAt: row.paid_at ? new Date(row.paid_at) : undefined,
    };
}
export async function getSettlementByBooking(bookingId) {
    const result = await query('SELECT * FROM settlements WHERE booking_id = $1', [bookingId]);
    if (result.rows.length === 0)
        return null;
    return mapRow(result.rows[0]);
}
/**
 * Persists a settlement for a completed booking. Idempotent via the
 * settlements.booking_id UNIQUE constraint: if a settlement already exists
 * (e.g. /complete retried), the existing row is returned instead of erroring
 * or double-counting the payout.
 */
export async function createSettlement(providerId, bookingId, grossAmount, platformFee, providerPayout) {
    const result = await query(`INSERT INTO settlements (id, provider_id, booking_id, gross_amount, platform_fee, provider_payout, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'approved', CURRENT_TIMESTAMP)
     ON CONFLICT (booking_id) DO NOTHING
     RETURNING *`, [uuidv4(), providerId, bookingId, grossAmount, platformFee, providerPayout]);
    if (result.rows.length > 0) {
        return mapRow(result.rows[0]);
    }
    const existing = await getSettlementByBooking(bookingId);
    return existing;
}
