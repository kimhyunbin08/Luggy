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
  city VARCHAR(50) NOT NULL DEFAULT '서울',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.1 Migration: add city to carriers created before this column existed
-- (CREATE TABLE IF NOT EXISTS above is a no-op on already-existing tables,
-- so this ALTER is required to bring staging/production DBs up to date.)
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS city VARCHAR(50) NOT NULL DEFAULT '서울';
CREATE INDEX IF NOT EXISTS idx_carriers_city ON carriers(city);

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

-- 5. Payments (결제) — provider is always 'mock' in this MVP; no real PG is integrated.
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  deposit_amount DECIMAL(10, 2),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'authorized', 'completed', 'refunded', 'failed'
  )),
  payment_method VARCHAR(50),
  provider VARCHAR(50) NOT NULL DEFAULT 'mock',
  payment_intent_id VARCHAR(255),
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5b. Webhook Events (서명 검증된 웹훅 수신 이력 + idempotency dedup)
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(255) UNIQUE NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('payment', 'delivery')),
  event_type VARCHAR(50) NOT NULL,
  booking_id UUID REFERENCES bookings(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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

-- 8. Settlements (정산) — one settlement per booking (idempotent completion)
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
  paid_at TIMESTAMPTZ,
  UNIQUE (booking_id)
);

-- 8b. Cost Entries (원가 — 건당 공헌이익 KPI 계산용. 정산 게이트 자동화에는 사용하지 않음)
CREATE TABLE IF NOT EXISTS cost_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  cost_type VARCHAR(50) NOT NULL CHECK (cost_type IN ('logistics', 'depreciation', 'other')),
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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

-- 11. Funnel Events (분석) — session_id persisted for funnel/ledger reconciliation
CREATE TABLE IF NOT EXISTS funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  session_id VARCHAR(255),
  event_type VARCHAR(100) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 12. Auth (동네 직거래 모드는 실제 사용자 구분이 필요해 최소 이메일/비밀번호 인증 추가)
-- password_hash is nullable so pre-existing demo/legacy rows (created before
-- this migration, e.g. the seeded MOCK_RENTER_ID/MOCK_PROVIDER_ID users) keep
-- working for the legacy platform-delivery flow, which never calls /auth/*.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- 13. Carriers: 브랜드/모델 분리(AI 인식 결과 저장용), 동 단위 위치, 거래방식 구분
-- brand/model are populated by AI photo recognition or manual entry and are
-- additive to the existing brand_model free-text field (kept for the legacy
-- flow's display strings, not removed).
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS brand VARCHAR(100);
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS model VARCHAR(100);
-- dong: 행정동 단위 텍스트(예: "역삼동"). 정확한 상세주소는 저장하지 않는다(프라이버시).
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS dong VARCHAR(100);
-- latitude/longitude: 동 중심 좌표 기준으로 저장(정확한 자택 좌표 아님, 지도 핀 표시용).
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS latitude DECIMAL(9, 6);
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS longitude DECIMAL(9, 6);
-- deal_mode: 'direct'(동네 직거래, 신규 메인 플로우) vs 'platform'(기존 배송·결제·검수 플로우, 레거시 유지).
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS deal_mode VARCHAR(20) NOT NULL DEFAULT 'platform'
  CHECK (deal_mode IN ('direct', 'platform'));
CREATE INDEX IF NOT EXISTS idx_carriers_dong ON carriers(dong);
CREATE INDEX IF NOT EXISTS idx_carriers_deal_mode ON carriers(deal_mode);

-- 14. Deal Requests (동네 직거래 요청 — 당근마켓 스타일)
-- Renter가 지도에서 캐리어를 보고 보내는 요청. 생성 즉시 채팅방 역할을 겸한다.
-- 결제/배송/검수는 이 플로우에서 다루지 않는다(당사자 간 직접 조율, PRD/TRD §Deferred 참조).
CREATE TABLE IF NOT EXISTS deal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'accepted', 'declined', 'cancelled', 'completed'
  )),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deal_requests_carrier ON deal_requests(carrier_id);
CREATE INDEX IF NOT EXISTS idx_deal_requests_requester ON deal_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_deal_requests_owner ON deal_requests(owner_id);

-- 15. Chat Messages (요청 1건당 1:1 채팅 스레드)
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_request_id UUID NOT NULL REFERENCES deal_requests(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_deal ON chat_messages(deal_request_id, created_at);

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
CREATE INDEX idx_ledger_idempotency ON ledger_entries(idempotency_key);
CREATE INDEX idx_webhook_events_booking ON webhook_events(booking_id);
CREATE INDEX idx_cost_entries_booking ON cost_entries(booking_id);
CREATE INDEX idx_funnel_session ON funnel_events(session_id);
CREATE INDEX idx_ledger_booking ON ledger_entries(booking_id);
CREATE INDEX idx_funnel_user ON funnel_events(user_id);
