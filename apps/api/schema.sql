-- Luggy MVP Database Schema
-- PostgreSQL 13+

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(20) NOT NULL CHECK (role IN ('provider', 'renter', 'admin')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Policy Versions (정책 관리)
CREATE TABLE IF NOT EXISTS policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number VARCHAR(20) UNIQUE NOT NULL,
  daily_price_carry_on DECIMAL(10, 2) NOT NULL DEFAULT 7900,
  daily_price_medium DECIMAL(10, 2) NOT NULL DEFAULT 11900,
  deposit_carry_on DECIMAL(10, 2) NOT NULL DEFAULT 30000,
  deposit_medium DECIMAL(10, 2) NOT NULL DEFAULT 50000,
  round_trip_shipping DECIMAL(10, 2) NOT NULL DEFAULT 14000,
  min_rental_days INTEGER NOT NULL DEFAULT 2,
  refund_full_hours INTEGER NOT NULL DEFAULT 48,
  refund_half_hours INTEGER NOT NULL DEFAULT 24,
  platform_fee_percent DECIMAL(5, 2) NOT NULL DEFAULT 80,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN DEFAULT true
);

-- 3. Carriers (러개지)
CREATE TABLE IF NOT EXISTS carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size VARCHAR(20) NOT NULL CHECK (size IN ('carry_on', 'medium')),
  brand_model VARCHAR(255) NOT NULL,
  base_price DECIMAL(10, 2) NOT NULL,
  condition VARCHAR(50) NOT NULL DEFAULT 'good',
  status VARCHAR(50) NOT NULL DEFAULT 'intake_pending' CHECK (status IN (
    'intake_pending', 'available', 'reserved', 'rented', 'return_processing', 'maintenance', 'retired'
  )),
  opt_in_rentable BOOLEAN DEFAULT false,
  intake_photo_url VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bookings (예약)
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  policy_version_id UUID NOT NULL REFERENCES policy_versions(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'payment_method_saved', 'payment_authorized', 'confirmed',
    'outbound_in_transit', 'in_use', 'return_in_transit', 'inspection_pending',
    'claim_resolving', 'completed', 'cancelled', 'overdue', 'lost', 'disputed'
  )),
  total_price DECIMAL(10, 2) NOT NULL,
  delivery_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (delivery_status IN (
    'pending', 'in_transit', 'arrived', 'delayed'
  )),
  claim_resolved BOOLEAN DEFAULT false,
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Payments (결제)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  deposit_amount DECIMAL(10, 2),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'authorized', 'completed', 'refunded', 'failed'
  )),
  payment_method VARCHAR(50),
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Inspections & Photos (검수)
CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  inspection_type VARCHAR(50) NOT NULL CHECK (inspection_type IN ('intake', 'outbound', 'return')),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'completed', 'approved', 'rejected'
  )),
  notes TEXT,
  inspector_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inspection_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  photo_url VARCHAR(500) NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Damage Claims (클레임)
CREATE TABLE IF NOT EXISTS damage_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  damage_type VARCHAR(50) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'resolved'
  )),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ
);

-- 8. Settlements (정산)
CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  gross_amount DECIMAL(10, 2) NOT NULL,
  platform_fee DECIMAL(10, 2) NOT NULL,
  provider_payout DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'paid', 'failed'
  )),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMPTZ
);

-- 9. Ledger Entries (금전 추적)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  user_id UUID REFERENCES users(id),
  entry_type VARCHAR(50) NOT NULL CHECK (entry_type IN (
    'charge', 'refund', 'deposit_hold', 'deposit_release', 'damage_charge'
  )),
  amount DECIMAL(10, 2) NOT NULL,
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 10. Delivery Orders (배송)
CREATE TABLE IF NOT EXISTS delivery_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  direction VARCHAR(50) NOT NULL CHECK (direction IN ('outbound', 'return')),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_transit', 'arrived', 'delayed', 'failed'
  )),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 11. Funnel Events (분석)
CREATE TABLE IF NOT EXISTS funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  event_type VARCHAR(100) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_carriers_provider ON carriers(provider_id);
CREATE INDEX idx_carriers_status ON carriers(status);
CREATE INDEX idx_bookings_renter ON bookings(renter_id);
CREATE INDEX idx_bookings_carrier ON bookings(carrier_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_dates ON bookings(start_date, end_date);
CREATE INDEX idx_inspections_booking ON inspections(booking_id);
CREATE INDEX idx_damage_claims_booking ON damage_claims(booking_id);
CREATE INDEX idx_settlements_provider ON settlements(provider_id);
CREATE INDEX idx_ledger_booking ON ledger_entries(booking_id);
CREATE INDEX idx_funnel_user ON funnel_events(user_id);
