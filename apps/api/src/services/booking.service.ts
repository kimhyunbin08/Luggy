import { query } from '../db/pool.js';
import { Booking } from '../models/types.js';
import { v4 as uuidv4 } from 'uuid';

export async function createBooking(
  renterId: string,
  carrierId: string,
  policyVersionId: string,
  startDate: Date,
  endDate: Date,
  totalPrice: number,
  idempotencyKey: string
): Promise<Booking | null> {
  const bookingId = uuidv4();
  const now = new Date();

  try {
    const result = await query(
      `INSERT INTO bookings 
        (id, renter_id, carrier_id, policy_version_id, start_date, end_date, 
         status, total_price, delivery_status, claim_resolved, idempotency_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        bookingId,
        renterId,
        carrierId,
        policyVersionId,
        startDate,
        endDate,
        'requested',
        totalPrice,
        'pending',
        false,
        idempotencyKey,
        now,
        now,
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      renterId: row.renter_id,
      carrierId: row.carrier_id,
      policyVersionId: row.policy_version_id,
      startDate: new Date(row.start_date),
      endDate: new Date(row.end_date),
      status: row.status,
      totalPrice: row.total_price,
      deliveryStatus: row.delivery_status,
      claimResolved: row.claim_resolved,
      idempotencyKey: row.idempotency_key,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  } catch (error) {
    // Idempotency: check if duplicate key exists
    if ((error as any).code === '23505') {
      const existing = await query(
        'SELECT * FROM bookings WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return {
          id: row.id,
          renterId: row.renter_id,
          carrierId: row.carrier_id,
          policyVersionId: row.policy_version_id,
          startDate: new Date(row.start_date),
          endDate: new Date(row.end_date),
          status: row.status,
          totalPrice: row.total_price,
          deliveryStatus: row.delivery_status,
          claimResolved: row.claim_resolved,
          idempotencyKey: row.idempotency_key,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        };
      }
    }
    throw error;
  }
}

export async function getBookingById(bookingId: string): Promise<Booking | null> {
  const result = await query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    renterId: row.renter_id,
    carrierId: row.carrier_id,
    policyVersionId: row.policy_version_id,
    startDate: new Date(row.start_date),
    endDate: new Date(row.end_date),
    status: row.status,
    totalPrice: row.total_price,
    deliveryStatus: row.delivery_status,
    claimResolved: row.claim_resolved,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function updateBookingStatus(bookingId: string, status: string): Promise<void> {
  await query(
    'UPDATE bookings SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [status, bookingId]
  );
}

export async function updateDeliveryStatus(bookingId: string, deliveryStatus: string): Promise<void> {
  await query(
    'UPDATE bookings SET delivery_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [deliveryStatus, bookingId]
  );
}

export async function getRenterBookings(renterId: string): Promise<Booking[]> {
  const result = await query(
    'SELECT * FROM bookings WHERE renter_id = $1 ORDER BY created_at DESC',
    [renterId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    renterId: row.renter_id,
    carrierId: row.carrier_id,
    policyVersionId: row.policy_version_id,
    startDate: new Date(row.start_date),
    endDate: new Date(row.end_date),
    status: row.status,
    totalPrice: row.total_price,
    deliveryStatus: row.delivery_status,
    claimResolved: row.claim_resolved,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function checkCarrierConflict(
  carrierId: string,
  startDate: Date,
  endDate: Date,
  excludeBookingId?: string
): Promise<boolean> {
  const query_str = excludeBookingId
    ? `SELECT 1 FROM bookings WHERE carrier_id = $1 AND status NOT IN ('cancelled', 'completed')
       AND start_date < $3 AND end_date > $2 AND id != $4 LIMIT 1`
    : `SELECT 1 FROM bookings WHERE carrier_id = $1 AND status NOT IN ('cancelled', 'completed')
       AND start_date < $3 AND end_date > $2 LIMIT 1`;

  const params = excludeBookingId ? [carrierId, startDate, endDate, excludeBookingId] : [carrierId, startDate, endDate];
  const result = await query(query_str, params);
  return result.rows.length > 0;
}
