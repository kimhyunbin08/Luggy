import express from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query } from './db/pool.js';
import * as carrierService from './services/carrier.service.js';
import * as bookingService from './services/booking.service.js';
import * as inspectionService from './services/inspection.service.js';
import * as policyService from './services/policy.service.js';
export function createApp() {
    const app = express();
    app.use((req, res, next) => {
        const origin = process.env.WEB_ORIGIN || '*';
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        next();
    });
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
    // POST /providers/carriers - Register a new carrier for storage
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
            const carrier = await carrierService.createCarrier(parsed.providerId, parsed.size, parsed.brandModel, parsed.basePrice, parsed.intakePhotoUrl);
            res.status(201).json(carrier);
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            console.error('Error creating carrier:', error);
            res.status(500).json({ error: 'Failed to create carrier' });
        }
    });
    // POST /providers/carriers/{id}/opt-in - Enable rental for a carrier
    app.post('/providers/carriers/:id/opt-in', async (req, res) => {
        try {
            const carrierId = req.params.id;
            const carrier = await carrierService.getCarrierById(carrierId);
            if (!carrier) {
                return res.status(404).json({ error: 'Carrier not found' });
            }
            // Check if carrier is in rentable state
            if (carrier.status !== 'available') {
                return res.status(400).json({
                    error: `Cannot opt-in: carrier status is ${carrier.status}`,
                });
            }
            await carrierService.setCarrierOptIn(carrierId, true);
            res.json({ success: true, message: 'Carrier now available for rental' });
        }
        catch (error) {
            console.error('Error enabling rental:', error);
            res.status(500).json({ error: 'Failed to enable rental' });
        }
    });
    // GET /providers/:id/carriers - List provider's carriers
    app.get('/providers/:id/carriers', async (req, res) => {
        try {
            const providerId = req.params.id;
            const carriers = await carrierService.getProviderCarriers(providerId);
            res.json({ carriers });
        }
        catch (error) {
            console.error('Error fetching providers carriers:', error);
            res.status(500).json({ error: 'Failed to fetch carriers' });
        }
    });
    // ============================================================
    // RENTER ENDPOINTS
    // ============================================================
    // GET /renters/search - Search for rentable carriers
    app.get('/renters/search', async (req, res) => {
        try {
            const size = req.query.size || 'carry_on';
            const startDateStr = req.query.start_date;
            const endDateStr = req.query.end_date;
            const sort = req.query.sort || 'recommended';
            if (!startDateStr || !endDateStr) {
                return res.status(400).json({
                    error: 'start_date and end_date query parameters are required',
                });
            }
            const startDate = new Date(startDateStr);
            const endDate = new Date(endDateStr);
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                return res.status(400).json({ error: 'Invalid date format' });
            }
            // Validate minimum rental days
            const rentalDays = policyService.calculateRentalDays(startDate, endDate);
            const policy = await policyService.getActivePolicy();
            if (rentalDays < policy.minRentalDays) {
                return res.status(400).json({
                    error: `Minimum rental period is ${policy.minRentalDays} days`,
                });
            }
            const availableCarriers = await carrierService.getAvailableCarriersForRental(size, startDate, endDate);
            const totalPrice = policyService.calculateTotalPrice(size, startDate, endDate, policy);
            const results = availableCarriers.map((carrier) => ({
                id: carrier.id,
                size: carrier.size,
                brandModel: carrier.brandModel,
                basePrice: carrier.basePrice,
                thumbnailUrl: carrier.intakePhotoUrl,
                inspectionBadge: carrier.intakePhotoUrl ? '검수 사진 확인' : '검수 진행',
                totalPrice,
                eta: '내일 도착',
                remainingQuantity: availableCarriers.length,
                provider: {
                    id: carrier.providerId,
                    rating: 4.8,
                    reviews: 42,
                },
            }));
            res.json({
                sort,
                items: results,
                metadata: {
                    startDate: startDateStr,
                    endDate: endDateStr,
                    rentalDays,
                },
            });
        }
        catch (error) {
            console.error('Error searching carriers:', error);
            res.status(500).json({ error: 'Search failed' });
        }
    });
    // GET /carriers/{id} - Get carrier details
    app.get('/carriers/:id', async (req, res) => {
        try {
            const carrier = await carrierService.getCarrierById(req.params.id);
            if (!carrier) {
                return res.status(404).json({ error: 'Carrier not found' });
            }
            res.json(carrier);
        }
        catch (error) {
            console.error('Error fetching carrier:', error);
            res.status(500).json({ error: 'Failed to fetch carrier' });
        }
    });
    // ============================================================
    // BOOKING ENDPOINTS
    // ============================================================
    // POST /bookings - Create a new booking
    app.post('/bookings', async (req, res) => {
        try {
            const schema = z.object({
                renterId: z.string().uuid(),
                carrierId: z.string().uuid(),
                startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
                endDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
                idempotencyKey: z.string().optional(),
            });
            const parsed = schema.parse(req.body);
            const startDate = new Date(parsed.startDate);
            const endDate = new Date(parsed.endDate);
            const idempotencyKey = parsed.idempotencyKey || uuidv4();
            // Get carrier and policy
            const carrier = await carrierService.getCarrierById(parsed.carrierId);
            if (!carrier) {
                return res.status(404).json({ error: 'Carrier not found' });
            }
            const policy = await policyService.getActivePolicy();
            // Validate minimum rental days
            const rentalDays = policyService.calculateRentalDays(startDate, endDate);
            if (rentalDays < policy.minRentalDays) {
                return res.status(400).json({
                    error: `Minimum rental period is ${policy.minRentalDays} days`,
                });
            }
            // Check for booking conflicts
            const conflict = await bookingService.checkCarrierConflict(parsed.carrierId, startDate, endDate);
            if (conflict) {
                return res.status(409).json({ error: 'Carrier is not available for this period' });
            }
            const totalPrice = policyService.calculateTotalPrice(carrier.size, startDate, endDate, policy);
            // Create booking
            const booking = await bookingService.createBooking(parsed.renterId, parsed.carrierId, policy.id, startDate, endDate, totalPrice, idempotencyKey);
            if (!booking) {
                return res.status(500).json({ error: 'Failed to create booking' });
            }
            // Log funnel event
            await query(`INSERT INTO funnel_events (user_id, event_type, metadata, created_at) 
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [parsed.renterId, 'booking_created', JSON.stringify({ bookingId: booking.id })]);
            res.status(201).json(booking);
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            console.error('Error creating booking:', error);
            res.status(500).json({ error: 'Failed to create booking' });
        }
    });
    // GET /bookings/{id} - Get booking details
    app.get('/bookings/:id', async (req, res) => {
        try {
            const booking = await bookingService.getBookingById(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            res.json(booking);
        }
        catch (error) {
            console.error('Error fetching booking:', error);
            res.status(500).json({ error: 'Failed to fetch booking' });
        }
    });
    // POST /bookings/{id}/authorize-payment - Authorize payment
    app.post('/bookings/:id/authorize-payment', async (req, res) => {
        try {
            const booking = await bookingService.getBookingById(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            // Update booking status
            await bookingService.updateBookingStatus(req.params.id, 'payment_authorized');
            // Log payment event
            await query(`INSERT INTO ledger_entries (booking_id, entry_type, amount, created_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [req.params.id, 'charge', booking.totalPrice]);
            res.json({
                success: true,
                message: 'Payment authorized',
                bookingId: req.params.id,
            });
        }
        catch (error) {
            console.error('Error authorizing payment:', error);
            res.status(500).json({ error: 'Failed to authorize payment' });
        }
    });
    // POST /bookings/{id}/cancel - Cancel a booking
    app.post('/bookings/:id/cancel', async (req, res) => {
        try {
            const booking = await bookingService.getBookingById(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            const policy = await policyService.getPolicyById(booking.policyVersionId);
            const refundAmount = policyService.calculateRefund(booking.totalPrice, new Date(), booking.createdAt, policy);
            await bookingService.updateBookingStatus(req.params.id, 'cancelled');
            // Log refund if any
            if (refundAmount > 0) {
                await query(`INSERT INTO ledger_entries (booking_id, entry_type, amount, created_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [req.params.id, 'refund', refundAmount]);
            }
            res.json({
                success: true,
                refundAmount,
                message: `Booking cancelled. Refund: ${refundAmount}`,
            });
        }
        catch (error) {
            console.error('Error cancelling booking:', error);
            res.status(500).json({ error: 'Failed to cancel booking' });
        }
    });
    // ============================================================
    // INSPECTION ENDPOINTS
    // ============================================================
    // POST /inspections - Upload inspection photos
    app.post('/inspections', async (req, res) => {
        try {
            const schema = z.object({
                bookingId: z.string().uuid(),
                inspectionType: z.enum(['intake', 'outbound', 'return']),
                photos: z.array(z.string().url()).min(1),
                inspectorId: z.string().uuid().optional(),
            });
            const parsed = schema.parse(req.body);
            const booking = await bookingService.getBookingById(parsed.bookingId);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            // Create inspection
            const inspection = await inspectionService.createInspection(parsed.bookingId, parsed.inspectionType, parsed.inspectorId);
            // Upload photos
            for (const photoUrl of parsed.photos) {
                await inspectionService.uploadInspectionPhoto(inspection.id, photoUrl);
            }
            // Mark inspection as completed
            await inspectionService.completeInspection(inspection.id, 'approved');
            res.status(201).json({
                success: true,
                inspectionId: inspection.id,
                photosCount: parsed.photos.length,
            });
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            console.error('Error creating inspection:', error);
            res.status(500).json({ error: 'Failed to upload inspection' });
        }
    });
    // GET /inspections/{id} - Get inspection details
    app.get('/inspections/:id', async (req, res) => {
        try {
            const inspection = await inspectionService.getInspectionById(req.params.id);
            if (!inspection) {
                return res.status(404).json({ error: 'Inspection not found' });
            }
            const photos = await inspectionService.getInspectionPhotos(req.params.id);
            res.json({ ...inspection, photos });
        }
        catch (error) {
            console.error('Error fetching inspection:', error);
            res.status(500).json({ error: 'Failed to fetch inspection' });
        }
    });
    // ============================================================
    // BOOKING LIFECYCLE ENDPOINTS
    // ============================================================
    // POST /bookings/{id}/complete - Complete a booking
    app.post('/bookings/:id/complete', async (req, res) => {
        try {
            const booking = await bookingService.getBookingById(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            // Check if inspection is done
            const inspections = await inspectionService.getBookingInspections(req.params.id);
            if (inspections.length === 0) {
                return res.status(400).json({ error: 'Inspection photos required before completing' });
            }
            // Update booking status
            await bookingService.updateBookingStatus(req.params.id, 'completed');
            // Calculate settlement
            const policy = await policyService.getPolicyById(booking.policyVersionId);
            const settlement = policyService.calculateSettlement(booking.totalPrice, policy);
            res.json({
                success: true,
                settlement,
                message: 'Booking completed',
            });
        }
        catch (error) {
            console.error('Error completing booking:', error);
            res.status(500).json({ error: 'Failed to complete booking' });
        }
    });
    // POST /claims/{id}/resolve - Resolve a damage claim
    app.post('/claims/:id/resolve', async (req, res) => {
        try {
            const schema = z.object({
                status: z.enum(['approved', 'rejected']),
                resolutionNotes: z.string().optional(),
            });
            const parsed = schema.parse(req.body);
            await query(`UPDATE damage_claims 
         SET status = $1, resolution_notes = $2, resolved_at = CURRENT_TIMESTAMP 
         WHERE id = $3`, [parsed.status, parsed.resolutionNotes, req.params.id]);
            res.json({
                success: true,
                message: 'Claim resolved',
            });
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            console.error('Error resolving claim:', error);
            res.status(500).json({ error: 'Failed to resolve claim' });
        }
    });
    // ============================================================
    // FUNNEL & EVENTS ENDPOINTS
    // ============================================================
    // POST /funnel/events - Log funnel events
    app.post('/funnel/events', async (req, res) => {
        try {
            const schema = z.object({
                eventType: z.string(),
                userId: z.string().uuid().optional(),
                sessionId: z.string().optional(),
                metadata: z.record(z.string(), z.unknown()).optional(),
            });
            const parsed = schema.parse(req.body);
            await query(`INSERT INTO funnel_events (user_id, event_type, metadata, created_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [parsed.userId, parsed.eventType, JSON.stringify(parsed.metadata || {})]);
            res.status(201).json({ success: true });
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed', details: error.issues });
            }
            console.error('Error logging funnel event:', error);
            res.status(500).json({ error: 'Failed to log event' });
        }
    });
    // ============================================================
    // WEBHOOK ENDPOINTS
    // ============================================================
    // POST /webhooks/payments - Payment status webhook
    app.post('/webhooks/payments', async (req, res) => {
        try {
            const schema = z.object({
                bookingId: z.string().uuid(),
                status: z.enum(['authorized', 'completed', 'failed']),
            });
            const parsed = schema.parse(req.body);
            const booking = await bookingService.getBookingById(parsed.bookingId);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            if (parsed.status === 'completed') {
                await bookingService.updateBookingStatus(parsed.bookingId, 'confirmed');
            }
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error processing payment webhook:', error);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    });
    // POST /webhooks/delivery - Delivery status webhook
    app.post('/webhooks/delivery', async (req, res) => {
        try {
            const schema = z.object({
                bookingId: z.string().uuid(),
                direction: z.enum(['outbound', 'return']),
                status: z.enum(['in_transit', 'arrived', 'delayed']),
            });
            const parsed = schema.parse(req.body);
            const booking = await bookingService.getBookingById(parsed.bookingId);
            if (!booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            await bookingService.updateDeliveryStatus(parsed.bookingId, parsed.status);
            // Update booking status based on delivery direction
            if (parsed.direction === 'outbound') {
                if (parsed.status === 'in_transit') {
                    await bookingService.updateBookingStatus(parsed.bookingId, 'outbound_in_transit');
                }
                else if (parsed.status === 'arrived') {
                    await bookingService.updateBookingStatus(parsed.bookingId, 'in_use');
                }
            }
            else if (parsed.direction === 'return') {
                if (parsed.status === 'in_transit') {
                    await bookingService.updateBookingStatus(parsed.bookingId, 'return_in_transit');
                }
                else if (parsed.status === 'arrived') {
                    await bookingService.updateBookingStatus(parsed.bookingId, 'inspection_pending');
                }
            }
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error processing delivery webhook:', error);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    });
    // ============================================================
    // HEALTH & METRICS
    // ============================================================
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
        });
    });
    app.get('/metrics/funnel', async (_req, res) => {
        try {
            const result = await query(`SELECT 
          event_type, 
          COUNT(*) as count 
         FROM funnel_events 
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY event_type
         ORDER BY count DESC`);
            res.json({
                period: '24h',
                events: result.rows,
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            console.error('Error fetching metrics:', error);
            res.status(500).json({ error: 'Failed to fetch metrics' });
        }
    });
    return app;
}
if (process.env.NODE_ENV !== 'test') {
    const app = createApp();
    const port = process.env.PORT || 3001;
    app.listen(port, () => {
        console.log(`[Luggy API] Server running on port ${port}`);
    });
}
