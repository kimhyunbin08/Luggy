import { query } from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';
function mapRow(row) {
    return {
        id: row.id,
        bookingId: row.booking_id,
        damageType: row.damage_type,
        amount: Number(row.amount),
        status: row.status,
        resolutionNotes: row.resolution_notes,
        createdAt: new Date(row.created_at),
        resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    };
}
export async function createClaim(bookingId, damageType, amount) {
    const claimId = uuidv4();
    const result = await query(`INSERT INTO damage_claims (id, booking_id, damage_type, amount, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', CURRENT_TIMESTAMP)
     RETURNING *`, [claimId, bookingId, damageType, amount]);
    return mapRow(result.rows[0]);
}
export async function getClaimById(claimId) {
    const result = await query('SELECT * FROM damage_claims WHERE id = $1', [claimId]);
    if (result.rows.length === 0)
        return null;
    return mapRow(result.rows[0]);
}
export async function getClaimsForBooking(bookingId) {
    const result = await query('SELECT * FROM damage_claims WHERE booking_id = $1 ORDER BY created_at DESC', [bookingId]);
    return result.rows.map(mapRow);
}
export async function getPendingClaimsForBooking(bookingId) {
    const result = await query(`SELECT * FROM damage_claims WHERE booking_id = $1 AND status = 'pending' ORDER BY created_at DESC`, [bookingId]);
    return result.rows.map(mapRow);
}
export async function resolveClaim(claimId, status, resolutionNotes) {
    const result = await query(`UPDATE damage_claims
     SET status = $1, resolution_notes = $2, resolved_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`, [status, resolutionNotes ?? null, claimId]);
    if (result.rows.length === 0)
        return null;
    return mapRow(result.rows[0]);
}
