// Data models and types for Luggy MVP

export type CarrierSize = 'carry_on' | 'medium';
export type UserRole = 'provider' | 'renter' | 'admin';
export type CarrierStatus = 
  | 'intake_pending'
  | 'available'
  | 'reserved'
  | 'rented'
  | 'return_processing'
  | 'maintenance'
  | 'retired';

export type BookingStatus = 
  | 'requested'
  | 'payment_method_saved'
  | 'payment_authorized'
  | 'confirmed'
  | 'outbound_in_transit'
  | 'in_use'
  | 'return_in_transit'
  | 'inspection_pending'
  | 'claim_resolving'
  | 'completed'
  | 'cancelled'
  | 'overdue'
  | 'lost'
  | 'disputed';

export type DeliveryStatus = 'pending' | 'in_transit' | 'arrived' | 'delayed';
export type InspectionType = 'intake' | 'outbound' | 'return';
export type InspectionStatus = 'pending' | 'completed' | 'approved' | 'rejected';

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

/** '동네 직거래' 요청/채팅 상태. 결제/배송/검수를 거치지 않는 별도 플로우(레거시 Booking과 무관). */
export type DealRequestStatus = 'requested' | 'accepted' | 'declined' | 'cancelled' | 'completed';
export type CarrierDealMode = 'direct' | 'platform';

export interface DealRequest {
  id: string;
  carrierId: string;
  requesterId: string;
  ownerId: string;
  status: DealRequestStatus;
  startDate?: string;
  endDate?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  dealRequestId: string;
  senderId: string;
  body: string;
  createdAt: Date;
}

export interface PolicyVersion {
  id: string;
  versionNumber: string;
  dailyPriceCarryOn: number;
  dailyPriceMedium: number;
  depositCarryOn: number;
  depositMedium: number;
  roundTripShipping: number;
  minRentalDays: number;
  refundFullHours: number;
  refundHalfHours: number;
  platformFeePercent: number;
  createdAt: Date;
  active: boolean;
}

export interface Carrier {
  id: string;
  providerId: string;
  size: CarrierSize;
  brandModel: string;
  /** AI 사진 인식 또는 수동 입력으로 채워지는 분리된 브랜드/모델명 (신규 '동네 직거래' 모드). */
  brand?: string;
  model?: string;
  basePrice: number;
  condition: string;
  status: CarrierStatus;
  optInRentable: boolean;
  intakePhotoUrl?: string;
  city: string;
  /** 행정동 단위 위치 텍스트(상세주소 아님, 프라이버시 보호). */
  dong?: string;
  latitude?: number;
  longitude?: number;
  /** 'direct' = 동네 직거래(신규 메인), 'platform' = 기존 배송·결제·검수(레거시, 유지). */
  dealMode: CarrierDealMode;
  createdAt: Date;
  updatedAt: Date;
}

export interface Booking {
  id: string;
  renterId: string;
  carrierId: string;
  policyVersionId: string;
  startDate: Date;
  endDate: Date;
  status: BookingStatus;
  totalPrice: number;
  deliveryStatus: DeliveryStatus;
  claimResolved: boolean;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Payment {
  id: string;
  bookingId: string;
  amount: number;
  depositAmount?: number;
  status: 'pending' | 'authorized' | 'completed' | 'refunded' | 'failed';
  paymentMethod?: string;
  provider?: string;
  paymentIntentId?: string;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEvent {
  id: string;
  eventId: string;
  source: 'payment' | 'delivery';
  eventType: string;
  bookingId?: string;
  payload: unknown;
  createdAt: Date;
}

export interface CostEntry {
  id: string;
  bookingId?: string;
  costType: 'logistics' | 'depreciation' | 'other';
  amount: number;
  createdAt: Date;
}

export interface Inspection {
  id: string;
  bookingId: string;
  inspectionType: InspectionType;
  status: InspectionStatus;
  notes?: string;
  inspectorId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InspectionPhoto {
  id: string;
  inspectionId: string;
  photoUrl: string;
  uploadedAt: Date;
}

export interface DamageClaim {
  id: string;
  bookingId: string;
  damageType: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'resolved';
  resolutionNotes?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface Settlement {
  id: string;
  providerId: string;
  bookingId: string;
  grossAmount: number;
  platformFee: number;
  providerPayout: number;
  status: 'pending' | 'approved' | 'paid' | 'failed';
  createdAt: Date;
  paidAt?: Date;
}

export interface LedgerEntry {
  id: string;
  bookingId?: string;
  userId?: string;
  entryType: 'charge' | 'refund' | 'deposit_hold' | 'deposit_release' | 'damage_charge';
  amount: number;
  idempotencyKey?: string;
  createdAt: Date;
}

export interface DeliveryOrder {
  id: string;
  bookingId: string;
  direction: 'outbound' | 'return';
  status: DeliveryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FunnelEvent {
  id: string;
  userId?: string;
  sessionId?: string;
  eventType: string;
  metadata?: any;
  createdAt: Date;
}
