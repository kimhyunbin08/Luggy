import { query } from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';
export async function createCarrier(providerId, size, brandModel, basePrice, intakePhotoUrl) {
    const carrierId = uuidv4();
    const now = new Date();
    const result = await query(`INSERT INTO carriers 
      (id, provider_id, size, brand_model, base_price, status, opt_in_rentable, intake_photo_url, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`, [
        carrierId,
        providerId,
        size,
        brandModel,
        basePrice,
        'intake_pending',
        false,
        intakePhotoUrl,
        now,
        now,
    ]);
    const row = result.rows[0];
    return {
        id: row.id,
        providerId: row.provider_id,
        size: row.size,
        brandModel: row.brand_model,
        basePrice: row.base_price,
        condition: row.condition,
        status: row.status,
        optInRentable: row.opt_in_rentable,
        intakePhotoUrl: row.intake_photo_url,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}
export async function getCarrierById(carrierId) {
    const result = await query('SELECT * FROM carriers WHERE id = $1', [carrierId]);
    if (result.rows.length === 0)
        return null;
    const row = result.rows[0];
    return {
        id: row.id,
        providerId: row.provider_id,
        size: row.size,
        brandModel: row.brand_model,
        basePrice: row.base_price,
        condition: row.condition,
        status: row.status,
        optInRentable: row.opt_in_rentable,
        intakePhotoUrl: row.intake_photo_url,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}
export async function updateCarrierStatus(carrierId, status) {
    await query('UPDATE carriers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [status, carrierId]);
}
export async function setCarrierOptIn(carrierId, optIn) {
    await query('UPDATE carriers SET opt_in_rentable = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [optIn, carrierId]);
}
export async function getProviderCarriers(providerId) {
    const result = await query('SELECT * FROM carriers WHERE provider_id = $1 ORDER BY created_at DESC', [providerId]);
    return result.rows.map((row) => ({
        id: row.id,
        providerId: row.provider_id,
        size: row.size,
        brandModel: row.brand_model,
        basePrice: row.base_price,
        condition: row.condition,
        status: row.status,
        optInRentable: row.opt_in_rentable,
        intakePhotoUrl: row.intake_photo_url,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    }));
}
export async function getAvailableCarriersForRental(size, startDate, endDate) {
    const result = await query(`SELECT DISTINCT c.* FROM carriers c
     WHERE c.size = $1 
       AND c.opt_in_rentable = true
       AND c.status = 'available'
       AND NOT EXISTS (
         SELECT 1 FROM bookings b 
         WHERE b.carrier_id = c.id 
           AND b.status NOT IN ('cancelled', 'completed')
           AND b.start_date < $3
           AND b.end_date > $2
       )
     ORDER BY c.created_at DESC`, [size, startDate, endDate]);
    return result.rows.map((row) => ({
        id: row.id,
        providerId: row.provider_id,
        size: row.size,
        brandModel: row.brand_model,
        basePrice: row.base_price,
        condition: row.condition,
        status: row.status,
        optInRentable: row.opt_in_rentable,
        intakePhotoUrl: row.intake_photo_url,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    }));
}
