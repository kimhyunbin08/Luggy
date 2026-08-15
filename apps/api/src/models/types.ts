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
  basePrice: number;
  condition: string;
  status: CarrierStatus;
  optInRentable: boolean;
  intakePhotoUrl?: string;
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
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
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
  eventType: string;
  metadata?: any;
  createdAt: Date;
}
