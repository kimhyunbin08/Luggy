import { query } from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';
function mapRow(row) {
    return {
        id: row.id,
        bookingId: row.booking_id,
        costType: row.cost_type,
        amount: Number(row.amount),
        createdAt: new Date(row.created_at),
    };
}
export async function recordCostEntry(bookingId, costType, amount) {
    const result = await query(`INSERT INTO cost_entries (id, booking_id, cost_type, amount, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     RETURNING *`, [uuidv4(), bookingId, costType, amount]);
    return mapRow(result.rows[0]);
}
export async function getCostEntriesForBooking(bookingId) {
    const result = await query('SELECT * FROM cost_entries WHERE booking_id = $1', [bookingId]);
    return result.rows.map(mapRow);
}
