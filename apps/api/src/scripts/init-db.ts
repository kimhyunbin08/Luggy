import { query, closePool } from '../db/pool.js';

async function initializeDatabase() {
  console.log('[DB] Initializing database...');

  try {
    // 1. Insert default policy version
    const policyResult = await query(
      `INSERT INTO policy_versions 
        (version_number, daily_price_carry_on, daily_price_medium, 
         deposit_carry_on, deposit_medium, round_trip_shipping,
         min_rental_days, refund_full_hours, refund_half_hours, 
         platform_fee_percent, active, created_at)
       VALUES 
        ('v1.0', 7900, 11900, 30000, 50000, 14000, 2, 48, 24, 80, true, CURRENT_TIMESTAMP)
       ON CONFLICT (version_number) DO NOTHING
       RETURNING id`
    );

    if (policyResult.rows.length > 0) {
      console.log(`[DB] Default policy created: ${policyResult.rows[0].id}`);
    } else {
      console.log('[DB] Default policy already exists');
    }

    // 2. Insert demo users used by the web frontend's MOCK_RENTER_ID /
    // MOCK_PROVIDER_ID (apps/web/src/main.ts). Without these, provider/renter
    // actions fail with a carriers_provider_id_fkey / bookings_renter_id_fkey
    // violation on any freshly-created database.
    const usersResult = await query(
      `INSERT INTO users (id, email, name, role) VALUES
        ('550e8400-e29b-41d4-a716-446655440000', 'renter@test.com', 'Renter', 'renter'),
        ('550e8400-e29b-41d4-a716-446655440001', 'provider@test.com', 'Provider', 'provider')
       ON CONFLICT (id) DO NOTHING
       RETURNING id`
    );

    if (usersResult.rows.length > 0) {
      console.log(`[DB] Demo users created: ${usersResult.rows.map((r) => r.id).join(', ')}`);
    } else {
      console.log('[DB] Demo users already exist');
    }

    console.log('[DB] Database initialization completed successfully');
    await closePool();
    process.exit(0);
  } catch (error) {
    console.error('[DB] Initialization failed:', error);
    await closePool();
    process.exit(1);
  }
}

initializeDatabase();
