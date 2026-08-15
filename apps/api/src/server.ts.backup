import express from 'express';
import { z } from 'zod';
import { calculateRefundAmount, calculateSettlement, calculateTotalPrice, validateMinimumRentalDays } from './domain/calculators.js';
import { CarrierSize, defaultPolicy, PolicyVersion } from './domain/policy.js';

type BookingStatus =
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
  | 'cancelled';

type Booking = {
  id: string;
  carrierId: string;
  size: CarrierSize;
  startDate: string;
  endDate: string;
  status: BookingStatus;
  totalPrice: number;
  policyVersionId: string;
  deliveryStatus: 'pending' | 'in_transit' | 'arrived' | 'delayed';
  claimResolved: boolean;
  inspectionPhotos: string[];
  idempotencyKey?: string;
  createdAt: string;
};

type Carrier = {
  id: string;
  size: CarrierSize;
  optIn: boolean;
  available: boolean;
  quantity: number;
};

const policyVersions: Map<string, PolicyVersion> = new Map([['v1', defaultPolicy]]);
const carriers: Carrier[] = [{ id: 'c1', size: 'carry_on' as CarrierSize, optIn: true, available: true, quantity: 5 }];
const bookings = new Map<string, Booking>();
const idempotencyCache = new Map<string, any>();

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/renters/search', (req, res) => {
    const size = (req.query.size as CarrierSize) || 'carry_on';
    const result = carriers
      .filter((c) => c.optIn && c.available && c.size === size)
      .map((c) => ({
        id: c.id,
        thumbnail: 'thumb.jpg',
        brandModel: 'Luggy Carry',
        rating: 4.8,
        reviews: 42,
        inspectionBadge: true,
        scarcity: '남은 수량 1개',
        originalPrice: 35000,
        totalPrice: calculateTotalPrice(size, new Date('2026-08-10'), new Date('2026-08-12'), defaultPolicy),
        eta: '내일 도착',
        remainingQuantity: 1
      }));
    res.json({ sort: 'recommended', items: result });
  });

  app.get('/carriers/:id', (req, res) => {
    const carrier = carriers.find((c) => c.id === req.params.id);
    if (!carrier) return res.status(404).json({ message: 'not found' });
    res.json(carrier);
  });

  app.post('/bookings', (req, res) => {
    const schema = z.object({
      carrierId: z.string(),
      size: z.enum(['carry_on', 'medium']),
      startDate: z.string(),
      endDate: z.string(),
      idempotencyKey: z.string().optional()
    });
    const parsed = schema.parse(req.body);
    
    // Idempotency check
    if (parsed.idempotencyKey && idempotencyCache.has(parsed.idempotencyKey)) {
      return res.status(200).json(idempotencyCache.get(parsed.idempotencyKey));
    }
    
    const start = new Date(parsed.startDate);
    const end = new Date(parsed.endDate);
    
    // Minimum rental days validation
    if (!validateMinimumRentalDays(start, end, defaultPolicy)) {
      return res.status(400).json({ message: 'minimum rental days is 2' });
    }
    
    // Carrier and quantity check
    const carrier = carriers.find((c) => c.id === parsed.carrierId);
    if (!carrier || !carrier.optIn || carrier.quantity <= 0) {
      return res.status(400).json({ message: 'carrier not available or out of stock' });
    }
    
    const id = `b_${bookings.size + 1}`;
    const booking: Booking = {
      id,
      carrierId: parsed.carrierId,
      size: parsed.size,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      status: 'requested',
      totalPrice: calculateTotalPrice(parsed.size, start, end, defaultPolicy),
      policyVersionId: defaultPolicy.id,
      deliveryStatus: 'pending',
      claimResolved: true,
      inspectionPhotos: [],
      idempotencyKey: parsed.idempotencyKey,
      createdAt: new Date().toISOString()
    };
    
    bookings.set(id, booking);
    
    // Cache idempotent response
    if (parsed.idempotencyKey) {
      idempotencyCache.set(parsed.idempotencyKey, booking);
    }
    
    res.status(201).json(booking);
  });

  app.get('/bookings/:id', (req, res) => {
    const booking = bookings.get(req.params.id);
    if (!booking) return res.status(404).json({ message: 'not found' });
    res.json(booking);
  });

  app.post('/bookings/:id/authorize-payment', (req, res) => {
    const booking = bookings.get(req.params.id);
    if (!booking) return res.status(404).json({ message: 'not found' });
    booking.status = 'payment_authorized';
    res.json({ ok: true, booking });
  });

  app.post('/bookings/:id/cancel', (req, res) => {
    const booking = bookings.get(req.params.id);
    if (!booking) return res.status(404).json({ message: 'not found' });
    const hoursBeforePickup = Number(req.body?.hoursBeforePickup ?? 0);
    const refundAmount = calculateRefundAmount(booking.totalPrice, hoursBeforePickup, defaultPolicy);
    booking.status = 'cancelled';
    res.json({ refundAmount });
  });

  app.post('/providers/carriers', (req, res) => {
    const id = `c${carriers.length + 1}`;
    carriers.push({ id, size: req.body?.size ?? 'carry_on', optIn: false, available: true, quantity: 1 });
    res.status(201).json({ id });
  });

  app.post('/providers/carriers/:id/opt-in', (req, res) => {
    const carrier = carriers.find((c) => c.id === req.params.id);
    if (!carrier) return res.status(404).json({ message: 'not found' });
    carrier.optIn = true;
    res.json({ ok: true });
  });

  app.post('/inspections', (req, res) => {
    const schema = z.object({ bookingId: z.string(), photos: z.array(z.string()).min(1) });
    const parsed = schema.parse(req.body);
    const booking = bookings.get(parsed.bookingId);
    if (!booking) return res.status(404).json({ message: 'not found' });
    booking.inspectionPhotos = parsed.photos;
    booking.status = 'inspection_pending';
    res.status(201).json({ ok: true });
  });

  app.post('/bookings/:id/complete', (req, res) => {
    const booking = bookings.get(req.params.id);
    if (!booking) return res.status(404).json({ message: 'not found' });
    if (booking.inspectionPhotos.length < 1) {
      return res.status(400).json({ message: 'inspection photo required' });
    }
    if (!booking.claimResolved) {
      return res.status(400).json({ message: 'claim unresolved' });
    }
    booking.status = 'completed';
    const settlement = calculateSettlement(booking.totalPrice, defaultPolicy);
    res.json({ settlement });
  });

  app.post('/claims/:id/resolve', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/funnel/events', (req, res) => {
    const schema = z.object({
      event: z.enum(['landing_view', 'search_submit', 'result_view', 'detail_view', 'checkout_step1', 'checkout_step2', 'checkout_step3', 'paid']),
      sessionId: z.string(),
      timestamp: z.string(),
      metadata: z.record(z.string(), z.any()).optional()
    });
    const parsed = schema.parse(req.body);
    console.log(`[FUNNEL] ${parsed.event} by session ${parsed.sessionId} at ${parsed.timestamp}`, parsed.metadata ?? {});
    res.status(201).json({ ok: true, received: parsed });
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      carriers: carriers.length,
      bookings: bookings.size,
      policyVersions: policyVersions.size
    });
  });

  app.get('/metrics/inventory', (req, res) => {
    const inventorySnapshot = carriers.map((c) => ({
      id: c.id,
      size: c.size,
      available: c.available,
      quantity: c.quantity,
      optIn: c.optIn
    }));
    res.json({ inventory: inventorySnapshot, timestamp: new Date().toISOString() });
  });

  app.get('/metrics/funnel', (req, res) => {
    res.json({
      totalBookings: bookings.size,
      completedBookings: Array.from(bookings.values()).filter((b) => b.status === 'completed').length,
      cancelledBookings: Array.from(bookings.values()).filter((b) => b.status === 'cancelled').length,
      timestamp: new Date().toISOString()
    });
  });


  app.post('/webhooks/delivery', (req, res) => {
    const schema = z.object({ bookingId: z.string(), status: z.enum(['in_transit', 'arrived', 'delayed']) });
    const parsed = schema.parse(req.body);
    const booking = bookings.get(parsed.bookingId);
    if (!booking) return res.status(404).json({ message: 'not found' });
    booking.deliveryStatus = parsed.status;
    if (parsed.status === 'in_transit') booking.status = 'outbound_in_transit';
    if (parsed.status === 'arrived') booking.status = 'in_use';
    res.json({ ok: true });
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = createApp();
  app.listen(3001, () => {
    // noop
  });
}
