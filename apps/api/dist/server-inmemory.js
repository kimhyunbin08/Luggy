import express from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
// In-memory storage
const carriers = new Map();
const bookings = new Map();
const inspections = new Map();
const funnel_events = [];
const policy = {
    minRentalDays: 2,
    dailyPrice: { carry_on: 7900, medium: 11900 },
    deposit: { carry_on: 30000, medium: 50000 },
    roundTripShipping: 14000,
    refund: { fullHours: 48, halfHours: 24 },
    platformFeePercent: 80,
};
function carrierView(carrier) {
    return {
        id: carrier.id,
        size: carrier.size,
        brandModel: carrier.brand_model,
        basePrice: carrier.base_price_won,
        thumbnailUrl: carrier.intake_photo_url || undefined,
        intakePhotoUrl: carrier.intake_photo_url || undefined,
        inspectionBadge: carrier.intake_photo_url ? '검수 사진 확인' : '검수 진행',
        optInRentable: carrier.is_opted_in,
        provider: {
            id: carrier.provider_id,
            rating: 4.8,
            reviews: 42,
        },
    };
}
export function createApp() {
    const app = express();
    const allowedOrigins = new Set((process.env.WEB_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean));
    app.use((req, res, next) => {
        const origin = req.header('Origin');
        if (origin && allowedOrigins.has(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Vary', 'Origin');
        }
        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        next();
    });
    app.use(express.json());
    // ============================================================
    // PROVIDER ENDPOINTS
    // ============================================================
    app.post('/providers/carriers', async (req, res) => {
        try {
            const schema = z.object({
                providerId: z.string().uuid(),
                size: z.enum(['carry_on', 'medium']),
                brandModel: z.string().min(1),
                basePrice: z.number().positive(),
                intakePhotoUrl: z.string().url().optional(),
            });
            const parsed = schema.parse(req.body);
            const carrier = {
                id: uuidv4(),
                provider_id: parsed.providerId,
                size: parsed.size,
                brand_model: parsed.brandModel,
                base_price_won: parsed.basePrice,
                intake_photo_url: parsed.intakePhotoUrl || '',
                is_opted_in: false,
                created_at: new Date().toISOString(),
            };
            carriers.set(carrier.id, carrier);
            res.status(201).json(carrierView(carrier));
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            res.status(500).json({ error: 'Failed to create carrier' });
        }
    });
    app.post('/providers/carriers/:id/opt-in', async (req, res) => {
        try {
            const carrier = carriers.get(req.params.id);
            if (!carrier) {
                return res.status(404).json({ error: 'Carrier not found' });
            }
            carrier.is_opted_in = true;
            res.json(carrierView(carrier));
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to opt-in carrier' });
        }
    });
    app.get('/providers/:providerId/carriers', async (req, res) => {
        try {
            const providerCarriers = Array.from(carriers.values()).filter((c) => c.provider_id === req.params.providerId);
            res.json({ carriers: providerCarriers.map(carrierView) });
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to fetch carriers' });
        }
    });
    // ============================================================
    // RENTER ENDPOINTS
    // ============================================================
    app.get('/renters/search', async (req, res) => {
        try {
            const schema = z.object({
                size: z.enum(['carry_on', 'medium']),
                start_date: z.string(),
                end_date: z.string(),
            });
            const parsed = schema.parse({
                size: req.query.size,
                start_date: req.query.start_date,
                end_date: req.query.end_date,
            });
            const startDate = new Date(parsed.start_date);
            const endDate = new Date(parsed.end_date);
            const rentalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            if (!Number.isFinite(rentalDays) || rentalDays < policy.minRentalDays) {
                return res.status(400).json({ error: `Minimum rental period is ${policy.minRentalDays} days` });
            }
            // Find available carriers (opt-in and no conflicts)
            const available = Array.from(carriers.values()).filter((carrier) => {
                if (!carrier.is_opted_in || carrier.size !== parsed.size)
                    return false;
                // Check no overlapping bookings
                const conflicts = Array.from(bookings.values()).filter((b) => {
                    if (b.carrier_id !== carrier.id || b.status === 'cancelled')
                        return false;
                    const bStart = new Date(b.start_date);
                    const bEnd = new Date(b.end_date);
                    return startDate < bEnd && endDate > bStart;
                });
                return conflicts.length === 0;
            });
            const totalPrice = policy.dailyPrice[parsed.size] * rentalDays + policy.roundTripShipping;
            const items = available.map((carrier) => ({
                ...carrierView(carrier),
                totalPrice,
                eta: '내일 도착',
                remainingQuantity: available.length,
            }));
            res.json({
                sort: req.query.sort || 'recommended',
                items,
                metadata: {
                    startDate: parsed.start_date,
                    endDate: parsed.end_date,
                    rentalDays,
                },
            });
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            res.status(500).json({ error: 'Failed to search carriers' });
        }
    });
    app.post('/bookings', async (req, res) => {
        try {
            const schema = z.object({
                renterId: z.string().uuid(),
                carrierId: z.string().uuid(),
                startDate: z.string(),
                endDate: z.string(),
            });
            const parsed = schema.parse(req.body);
            const carrier = carriers.get(parsed.carrierId);
            if (!carrier) {
                return res.status(404).json({ error: 'Carrier not found' });
            }
            const booking = {
                id: uuidv4(),
                renter_id: parsed.renterId,
                carrier_id: parsed.carrierId,
                start_date: parsed.startDate,
                end_date: parsed.endDate,
                status: 'pending_payment',
                policy_version_id: 'v1.0',
                gross_amount_won: 100000, // Calculated
                deposit_amount_won: policy.deposit[carrier.size],
                created_at: new Date().toISOString(),
            };
            bookings.set(booking.id, booking);
            res.status(201).json(booking);
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            res.status(500).json({ error: 'Failed to create booking' });
        }
    });
    app.get('/bookings/:id', async (req, res) => {
        try {
            const booking = bookings.get(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            res.json(booking);
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to fetch booking' });
        }
    });
    app.post('/bookings/:id/authorize-payment', async (req, res) => {
        try {
            const booking = bookings.get(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            booking.status = 'paid';
            res.json(booking);
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to authorize payment' });
        }
    });
    app.post('/bookings/:id/cancel', async (req, res) => {
        try {
            const booking = bookings.get(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            booking.status = 'cancelled';
            booking.cancelled_at = new Date().toISOString();
            res.json(booking);
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to cancel booking' });
        }
    });
    app.post('/bookings/:id/complete', async (req, res) => {
        try {
            const booking = bookings.get(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            booking.status = 'completed';
            booking.completed_at = new Date().toISOString();
            res.json(booking);
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to complete booking' });
        }
    });
    // ============================================================
    // OPERATIONS ENDPOINTS
    // ============================================================
    app.post('/inspections', async (req, res) => {
        try {
            const schema = z.object({
                bookingId: z.string().uuid(),
                inspectionType: z.enum(['intake', 'outbound', 'return']),
                photos: z.array(z.string().url()),
            });
            const parsed = schema.parse(req.body);
            const inspection = {
                id: uuidv4(),
                booking_id: parsed.bookingId,
                inspection_type: parsed.inspectionType,
                photos: parsed.photos,
                created_at: new Date().toISOString(),
            };
            inspections.set(inspection.id, inspection);
            res.status(201).json(inspection);
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            res.status(500).json({ error: 'Failed to create inspection' });
        }
    });
    // ============================================================
    // WEBHOOK ENDPOINTS
    // ============================================================
    app.post('/webhooks/delivery', async (req, res) => {
        try {
            const schema = z.object({
                bookingId: z.string().uuid(),
                direction: z.enum(['outbound', 'return']),
                status: z.enum(['in_transit', 'arrived', 'delayed']),
            });
            const parsed = schema.parse(req.body);
            const booking = bookings.get(parsed.bookingId);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            booking.delivery_status = parsed.status;
            res.json({ success: true, booking });
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            res.status(500).json({ error: 'Failed to update delivery status' });
        }
    });
    // ============================================================
    // ANALYTICS ENDPOINTS
    // ============================================================
    app.post('/funnel/events', async (req, res) => {
        try {
            const schema = z.object({
                eventType: z.enum([
                    'landing_view',
                    'search_submit',
                    'result_view',
                    'detail_view',
                    'checkout_step1',
                    'checkout_step2',
                    'checkout_step3',
                    'paid',
                ]),
                metadata: z.record(z.string(), z.unknown()).optional(),
            });
            const parsed = schema.parse(req.body);
            const event = {
                id: uuidv4(),
                event_type: parsed.eventType,
                metadata: parsed.metadata || {},
                created_at: new Date().toISOString(),
            };
            funnel_events.push(event);
            res.status(201).json(event);
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            res.status(500).json({ error: 'Failed to log event' });
        }
    });
    app.get('/metrics/funnel', async (req, res) => {
        try {
            const events = funnel_events.reduce((acc, evt) => {
                acc[evt.event_type] = (acc[evt.event_type] || 0) + 1;
                return acc;
            }, {});
            res.json({
                total_events: funnel_events.length,
                events_by_type: events,
            });
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to fetch metrics' });
        }
    });
    // ============================================================
    // HEALTH CHECK
    // ============================================================
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            database: 'in-memory',
            carriers: carriers.size,
            bookings: bookings.size,
        });
    });
    return app;
}
