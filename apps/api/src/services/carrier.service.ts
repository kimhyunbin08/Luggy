import { query } from '../db/pool.js';
import { Carrier, CarrierSize } from '../models/types.js';
import { v4 as uuidv4 } from 'uuid';

function mapRowToCarrier(row: any): Carrier {
  return {
    id: row.id,
    providerId: row.provider_id,
    size: row.size,
    brandModel: row.brand_model,
    brand: row.brand ?? undefined,
    model: row.model ?? undefined,
    basePrice: Number(row.base_price),
    condition: row.condition,
    status: row.status,
    optInRentable: row.opt_in_rentable,
    intakePhotoUrl: row.intake_photo_url,
    city: row.city,
    dong: row.dong ?? undefined,
    latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : undefined,
    longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : undefined,
    dealMode: row.deal_mode,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface CreateCarrierInput {
  providerId: string;
  size: CarrierSize;
  brandModel: string;
  basePrice: number;
  intakePhotoUrl?: string;
  city?: string;
  /** When true, the carrier is created already opted-in (status 'available')
   * in the same INSERT, instead of requiring a separate opt-in call. This
   * closes the race where a provider's create succeeds but a follow-up
   * opt-in call is dropped, leaving the carrier stuck at intake_pending. */
  optInRentable?: boolean;
  /** '동네 직거래' fields — all optional so the legacy platform-delivery
   * registration form (which doesn't collect these) keeps working untouched. */
  brand?: string;
  model?: string;
  dong?: string;
  latitude?: number;
  longitude?: number;
  dealMode?: 'direct' | 'platform';
}

export async function createCarrier(input: CreateCarrierInput): Promise<Carrier> {
  const carrierId = uuidv4();
  const now = new Date();
  const optInRentable = input.optInRentable ?? false;
  const city = input.city?.trim() || '서울';
  const status = optInRentable ? 'available' : 'intake_pending';
  const dealMode = input.dealMode ?? 'platform';

  const result = await query(
    `INSERT INTO carriers 
      (id, provider_id, size, brand_model, base_price, status, opt_in_rentable, intake_photo_url, city,
       brand, model, dong, latitude, longitude, deal_mode, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      carrierId,
      input.providerId,
      input.size,
      input.brandModel,
      input.basePrice,
      status,
      optInRentable,
      input.intakePhotoUrl,
      city,
      input.brand || null,
      input.model || null,
      input.dong || null,
      input.latitude ?? null,
      input.longitude ?? null,
      dealMode,
      now,
      now,
    ]
  );

  return mapRowToCarrier(result.rows[0]);
}

/**
 * Carriers for the Kakao map view: only 'direct' (동네 직거래) mode, rentable,
 * available, and actually geotagged. Returns the anonymized dong-level
 * location only — never a precise home address (see schema.sql §13).
 */
export async function getCarriersForMap(size?: CarrierSize): Promise<Carrier[]> {
  const result = await query(
    `SELECT * FROM carriers
     WHERE deal_mode = 'direct'
       AND opt_in_rentable = true
       AND status = 'available'
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL
       AND ($1::text IS NULL OR size = $1)
     ORDER BY created_at DESC`,
    [size ?? null]
  );
  return result.rows.map(mapRowToCarrier);
}

export async function getCarrierById(carrierId: string): Promise<Carrier | null> {
  const result = await query('SELECT * FROM carriers WHERE id = $1', [carrierId]);
  if (result.rows.length === 0) return null;

  return mapRowToCarrier(result.rows[0]);
}

export async function updateCarrierStatus(carrierId: string, status: string): Promise<void> {
  await query(
    'UPDATE carriers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [status, carrierId]
  );
}

export async function setCarrierOptIn(carrierId: string, optIn: boolean): Promise<void> {
  // Opt-in is the MVP's "ready for rental" signal: it also flips the coarse carrier
  // status between 'intake_pending' and 'available'. Actual per-date scarcity is
  // computed separately via the booking overlap check in getAvailableCarriersForRental,
  // so this status is only an administrative gate (not touched by booking lifecycle).
  await query(
    `UPDATE carriers
     SET opt_in_rentable = $1,
         status = CASE
           WHEN $1 = true THEN 'available'
           WHEN status = 'available' THEN 'intake_pending'
           ELSE status
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [optIn, carrierId]
  );
}

export async function getProviderCarriers(providerId: string): Promise<Carrier[]> {
  const result = await query(
    'SELECT * FROM carriers WHERE provider_id = $1 ORDER BY created_at DESC',
    [providerId]
  );

  return result.rows.map(mapRowToCarrier);
}

export async function getAvailableCarriersForRental(
  size: CarrierSize,
  startDate: Date,
  endDate: Date,
  city?: string
): Promise<Carrier[]> {
  const result = await query(
    `SELECT DISTINCT c.* FROM carriers c
     WHERE c.size = $1 
       AND c.opt_in_rentable = true
       AND c.status = 'available'
       AND ($4::text IS NULL OR c.city = $4)
       AND NOT EXISTS (
         SELECT 1 FROM bookings b 
         WHERE b.carrier_id = c.id 
           AND b.status NOT IN ('cancelled', 'completed')
           AND b.start_date < $3
           AND b.end_date > $2
       )
     ORDER BY c.created_at DESC`,
    [size, startDate, endDate, city ?? null]
  );

  return result.rows.map(mapRowToCarrier);
}

export async function getCitiesWithAvailability(
  size: CarrierSize,
  startDate: Date,
  endDate: Date
): Promise<string[]> {
  // Reuses the exact same availability rule as getAvailableCarriersForRental
  // (no city filter) so the returned list always matches what a renter would
  // actually be able to book, instead of drifting from a separately
  // maintained list of cities.
  const carriers = await getAvailableCarriersForRental(size, startDate, endDate);
  return Array.from(new Set(carriers.map((c) => c.city))).sort();
}
