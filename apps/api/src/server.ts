import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query } from './db/pool.js';
import * as carrierService from './services/carrier.service.js';
import * as bookingService from './services/booking.service.js';
import * as inspectionService from './services/inspection.service.js';
import * as policyService from './services/policy.service.js';
import * as paymentService from './services/payment.service.js';
import * as deliveryService from './services/delivery.service.js';
import * as ledgerService from './services/ledger.service.js';
import * as claimService from './services/claim.service.js';
import * as settlementService from './services/settlement.service.js';
import * as costService from './services/cost.service.js';
import * as storageService from './services/storage.service.js';
import * as metricsService from './services/metrics.service.js';
import { WebhookSignatureError } from './services/webhook.service.js';
import * as authService from './services/auth.service.js';
import { AuthError } from './services/auth.service.js';
import * as aiService from './services/ai.service.js';
import { AiNotConfiguredError } from './services/ai.service.js';
import * as dealService from './services/deal.service.js';
import { DealError } from './services/deal.service.js';
import { CarrierSize, DealRequestStatus } from './models/types.js';

const PLATFORM_LOGISTICS_COST_RATIO = Number(process.env.PLATFORM_LOGISTICS_COST_RATIO || '0.7');

export function createApp() {
  const app = express();
  app.use((req, res, next) => {
    const origin = process.env.WEB_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Payment-Signature, X-Delivery-Signature');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });
  const allowedOrigins = new Set(
    (process.env.WEB_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );

  app.use((req, res, next) => {
    const origin = req.header('Origin');
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment-Signature, X-Delivery-Signature');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });
  // Capture the raw request body bytes alongside JSON parsing so webhook
  // routes can verify an HMAC signature computed over the exact bytes sent,
  // not a re-serialized (and potentially differently-formatted) JSON object.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    })
  );

  // Local-disk photo upload fallback, served statically so blobUrl values
  // returned by /uploads/sign resolve to real files when Azure Blob Storage
  // isn't configured.
  app.use('/uploads/files', express.static(storageService.getLocalUploadDir()));
  const localUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

  // Required for every '동네 직거래' endpoint (AI registration, map requests,
  // deal chat) — these need a real, distinguishable user, unlike the legacy
  // platform-delivery flow's MOCK_RENTER_ID/MOCK_PROVIDER_ID. Attaches the
  // authenticated user id as req.userId; does not touch legacy routes.
  // <P> is left generic (no explicit/default type arg) on purpose: Express 5's
  // route-param typing infers a route's specific `req.params` shape only when
  // every handler in `app.get(path, ...handlers)` shares the same inferred P.
  // A non-generic req: express.Request here would pin P to the wide default
  // ParamsDictionary for the whole handler chain, widening req.params.id to
  // `string | string[]` in every handler that follows this middleware.
  function requireAuth<P>(req: express.Request<P>, res: express.Response, next: express.NextFunction) {
    const header = req.header('Authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const userId = authService.verifyToken(token);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: missing or invalid token' });
    }
    (req as unknown as express.Request & { userId?: string }).userId = userId;
    next();
  }

  // ============================================================
  // AUTH ENDPOINTS (동네 직거래 모드 전용 — 실사용자 식별용 최소 이메일/비밀번호 인증)
  // ============================================================

  app.post('/auth/signup', async (req, res) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다'),
        name: z.string().min(1),
        phone: z.string().min(1).max(20).optional(),
      });
      const parsed = schema.parse(req.body);
      const user = await authService.signup(parsed);
      const token = authService.signToken(user.id);
      res.status(201).json({ token, user });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      if (error instanceof Error && error.message === 'EMAIL_TAKEN') {
        return res.status(409).json({ error: '이미 가입된 이메일입니다' });
      }
      console.error('Error signing up:', error);
      res.status(500).json({ error: 'Failed to sign up' });
    }
  });

  app.post('/auth/login', async (req, res) => {
    try {
      const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
      const parsed = schema.parse(req.body);
      const user = await authService.login(parsed.email, parsed.password);
      const token = authService.signToken(user.id);
      res.json({ token, user });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      if (error instanceof AuthError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error logging in:', error);
      res.status(500).json({ error: 'Failed to log in' });
    }
  });

  app.get('/auth/me', requireAuth, async (req, res) => {
    try {
      const userId = (req as express.Request & { userId?: string }).userId as string;
      const user = await authService.findUserById(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ user });
    } catch (error) {
      console.error('Error fetching current user:', error);
      res.status(500).json({ error: 'Failed to fetch current user' });
    }
  });

  // ============================================================
  // PROVIDER ENDPOINTS
  // ============================================================

  // POST /providers/carriers - Register a new carrier for storage
  app.post('/providers/carriers', async (req, res) => {
    try {
      // Optional auth: the legacy platform-delivery flow calls this
      // unauthenticated with providerId in the body (preserved for backward
      // compatibility with the existing E2E gates). The '동네 직거래' flow
      // sends a Bearer token instead, and the authenticated user's id always
      // wins over anything the client puts in the body, so nobody can create
      // a direct-deal listing under someone else's identity.
      const authHeader = req.header('Authorization');
      const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const authedUserId = authService.verifyToken(tokenFromHeader);

      const schema = z.object({
        providerId: z.string().uuid().optional(),
        size: z.enum(['carry_on', 'medium']),
        brandModel: z.string().min(1),
        basePrice: z.number().positive(),
        intakePhotoUrl: z.string().url().optional(),
        city: z.string().min(1).max(50).optional(),
        // Lets the create call double as an opt-in so a dropped/failed
        // follow-up opt-in request can no longer leave a carrier stuck at
        // intake_pending (see POST /providers/carriers/{id}/opt-in, which
        // remains available separately as a retry path).
        optInRentable: z.boolean().optional(),
        // '동네 직거래' fields (all optional; omitted entirely by the legacy form).
        brand: z.string().min(1).max(100).optional(),
        model: z.string().min(1).max(100).optional(),
        dong: z.string().min(1).max(100).optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        dealMode: z.enum(['direct', 'platform']).optional(),
      });

      const parsed = schema.parse(req.body);
      const providerId = authedUserId || parsed.providerId;
      if (!providerId) {
        return res.status(400).json({ error: 'providerId is required (or send a valid Authorization token)' });
      }

      const carrier = await carrierService.createCarrier({
        providerId,
        size: parsed.size as CarrierSize,
        brandModel: parsed.brandModel,
        basePrice: parsed.basePrice,
        intakePhotoUrl: parsed.intakePhotoUrl,
        city: parsed.city,
        optInRentable: parsed.optInRentable,
        brand: parsed.brand,
        model: parsed.model,
        dong: parsed.dong,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        dealMode: parsed.dealMode,
      });

      res.status(201).json(carrier);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      console.error('Error creating carrier:', error);
      res.status(500).json({ error: 'Failed to create carrier' });
    }
  });

  // GET /carriers/map - '동네 직거래' 지도 뷰: 대여 가능한 direct-mode 캐리어를
  // 동 단위 좌표로 반환한다(정확한 주소 아님). 인증 불필요(공개 탐색).
  app.get('/carriers/map', async (req, res) => {
    try {
      const sizeParam = req.query.size as string | undefined;
      const size = sizeParam === 'carry_on' || sizeParam === 'medium' ? (sizeParam as CarrierSize) : undefined;
      const carriers = await carrierService.getCarriersForMap(size);
      res.json({
        items: carriers.map((c) => ({
          id: c.id,
          size: c.size,
          brand: c.brand,
          model: c.model,
          brandModel: c.brandModel,
          basePrice: c.basePrice,
          thumbnailUrl: c.intakePhotoUrl,
          dong: c.dong,
          latitude: c.latitude,
          longitude: c.longitude,
        })),
      });
    } catch (error) {
      console.error('Error fetching map carriers:', error);
      res.status(500).json({ error: 'Failed to fetch map carriers' });
    }
  });

  // POST /providers/carriers/ai-register/photo - AI(Azure OpenAI Vision)로
  // 업로드된 사진에서 브랜드/모델/사이즈/상태를 추정한 초안을 반환한다.
  // 사용자는 반환된 draft를 폼에서 확인/수정한 뒤 POST /providers/carriers로 제출한다.
  app.post('/providers/carriers/ai-register/photo', requireAuth, async (req, res) => {
    try {
      const schema = z.object({ photoUrl: z.string().url() });
      const parsed = schema.parse(req.body);
      const draft = await aiService.analyzeCarrierPhoto(parsed.photoUrl);
      res.json({ draft });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      if (error instanceof AiNotConfiguredError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error analyzing carrier photo:', error);
      res.status(500).json({ error: 'Failed to analyze photo' });
    }
  });

  // POST /providers/carriers/ai-register/chat - AI 챗봇 등록 대화 한 턴을 처리한다.
  // Stateless: 클라이언트가 전체 대화 이력을 매번 함께 보낸다.
  app.post('/providers/carriers/ai-register/chat', requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        messages: z
          .array(
            z.object({
              role: z.enum(['system', 'user', 'assistant']),
              content: z.string().min(1),
            })
          )
          .min(1),
      });
      const parsed = schema.parse(req.body);
      const result = await aiService.runRegistrationChatTurn(parsed.messages);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      if (error instanceof AiNotConfiguredError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error running AI registration chat turn:', error);
      res.status(500).json({ error: 'Failed to process chat message' });
    }
  });

  // ============================================================
  // DEAL REQUEST / CHAT ENDPOINTS (동네 직거래 — 결제/배송/검수 없음)
  // ============================================================

  // POST /deals - Renter가 지도/카드에서 캐리어에 보내는 요청. 생성 즉시 채팅방을 겸한다.
  app.post('/deals', requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        carrierId: z.string().uuid(),
        message: z.string().min(1).max(2000),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      });
      const parsed = schema.parse(req.body);
      const requesterId = (req as express.Request & { userId?: string }).userId as string;
      const deal = await dealService.createDealRequest({
        carrierId: parsed.carrierId,
        requesterId,
        message: parsed.message,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
      });
      res.status(201).json(deal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      if (error instanceof DealError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error creating deal request:', error);
      res.status(500).json({ error: 'Failed to create deal request' });
    }
  });

  // GET /deals - 내가 보냈거나(Renter) 받은(Owner) 요청 목록
  app.get('/deals', requireAuth, async (req, res) => {
    try {
      const userId = (req as express.Request & { userId?: string }).userId as string;
      const deals = await dealService.listDealRequestsForUser(userId);
      res.json({ items: deals });
    } catch (error) {
      console.error('Error listing deal requests:', error);
      res.status(500).json({ error: 'Failed to list deal requests' });
    }
  });

  app.get('/deals/:id', requireAuth, async (req, res) => {
    try {
      const userId = (req as express.Request & { userId?: string }).userId as string;
      const deal = await dealService.getDealRequestById(req.params.id);
      if (!deal) return res.status(404).json({ error: 'Deal request not found' });
      if (deal.requesterId !== userId && deal.ownerId !== userId) {
        return res.status(403).json({ error: 'Not a participant in this deal request' });
      }
      res.json(deal);
    } catch (error) {
      console.error('Error fetching deal request:', error);
      res.status(500).json({ error: 'Failed to fetch deal request' });
    }
  });

  // POST /deals/{id}/status - accept|decline|complete(owner-only)/cancel(either side)
  app.post('/deals/:id/status', requireAuth, async (req, res) => {
    try {
      const schema = z.object({ status: z.enum(['accepted', 'declined', 'cancelled', 'completed']) });
      const parsed = schema.parse(req.body);
      const userId = (req as express.Request & { userId?: string }).userId as string;
      const deal = await dealService.updateDealStatus({
        dealRequestId: req.params.id,
        actingUserId: userId,
        nextStatus: parsed.status as DealRequestStatus,
      });
      res.json(deal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      if (error instanceof DealError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error updating deal request status:', error);
      res.status(500).json({ error: 'Failed to update deal request status' });
    }
  });

  app.post('/deals/:id/messages', requireAuth, async (req, res) => {
    try {
      const schema = z.object({ body: z.string().min(1).max(2000) });
      const parsed = schema.parse(req.body);
      const userId = (req as express.Request & { userId?: string }).userId as string;
      const message = await dealService.addChatMessage(req.params.id, userId, parsed.body);
      res.status(201).json(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      if (error instanceof DealError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error sending chat message:', error);
      res.status(500).json({ error: 'Failed to send chat message' });
    }
  });

  // GET /deals/{id}/messages - 폴링 기반 채팅 조회 (신규 메시지 유무는 클라이언트가 주기적으로 재조회)
  app.get('/deals/:id/messages', requireAuth, async (req, res) => {
    try {
      const userId = (req as express.Request & { userId?: string }).userId as string;
      const messages = await dealService.listChatMessages(req.params.id, userId);
      res.json({ items: messages });
    } catch (error) {
      if (error instanceof DealError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error listing chat messages:', error);
      res.status(500).json({ error: 'Failed to list chat messages' });
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

      // Opt-in is what completes the 등록(intake_pending) -> Opt-in ->
      // 입고 가능(available) transition (TRD AC#7); only carriers that are
      // administratively locked (maintenance/retired) or mid-lifecycle on an
      // active booking (reserved/rented/return_processing) are rejected.
      if (!['intake_pending', 'available'].includes(carrier.status)) {
        return res.status(400).json({
          error: `Cannot opt-in: carrier status is ${carrier.status}`,
        });
      }

      await carrierService.setCarrierOptIn(carrierId, true);
      res.json({ success: true, message: 'Carrier now available for rental' });
    } catch (error) {
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
    } catch (error) {
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
      const size = (req.query.size as string) || 'carry_on';
      const startDateStr = req.query.start_date as string;
      const endDateStr = req.query.end_date as string;
      const sort = (req.query.sort as string) || 'recommended';
      // Optional: filter to a single city. Omitted/blank means "전체 도시"
      // (no filter), matching pre-existing behavior for callers that don't
      // send it (e.g. the E2E gate suite).
      const cityParam = (req.query.city as string) || '';
      const city = cityParam.trim() || undefined;

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

      const availableCarriers = await carrierService.getAvailableCarriersForRental(
        size as CarrierSize,
        startDate,
        endDate,
        city
      );

      const totalPrice = policyService.calculateTotalPrice(
        size as CarrierSize,
        startDate,
        endDate,
        policy
      );

      const results = availableCarriers.map((carrier) => ({
        id: carrier.id,
        size: carrier.size,
        brandModel: carrier.brandModel,
        basePrice: carrier.basePrice,
        city: carrier.city,
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
          city: city || null,
        },
      });
    } catch (error) {
      console.error('Error searching carriers:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // GET /carriers/cities - Cities that currently have rentable inventory for
  // a given size/date range. Drives the renter-side city <select>, which is
  // fully data-driven (no hardcoded city list) so it always reflects real
  // availability instead of drifting out of sync with it.
  app.get('/carriers/cities', async (req, res) => {
    try {
      const size = (req.query.size as string) || 'carry_on';
      const startDateStr = req.query.start_date as string;
      const endDateStr = req.query.end_date as string;

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

      const cities = await carrierService.getCitiesWithAvailability(
        size as CarrierSize,
        startDate,
        endDate
      );

      res.json({ cities });
    } catch (error) {
      console.error('Error fetching available cities:', error);
      res.status(500).json({ error: 'Failed to fetch cities' });
    }
  });


  app.get('/carriers/:id', async (req, res) => {
    try {
      const carrier = await carrierService.getCarrierById(req.params.id);
      if (!carrier) {
        return res.status(404).json({ error: 'Carrier not found' });
      }
      res.json(carrier);
    } catch (error) {
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
        sessionId: z.string().optional(),
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
      const booking = await bookingService.createBooking(
        parsed.renterId,
        parsed.carrierId,
        policy.id,
        startDate,
        endDate,
        totalPrice,
        idempotencyKey
      );

      if (!booking) {
        return res.status(500).json({ error: 'Failed to create booking' });
      }

      // Log funnel event (server-side dual logging alongside the client's own
      // checkout_step3 event, per TRD risk mitigation for funnel data loss)
      await query(
        `INSERT INTO funnel_events (user_id, session_id, event_type, metadata, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [parsed.renterId, parsed.sessionId, 'booking_created', JSON.stringify({ bookingId: booking.id })]
      );

      res.status(201).json(booking);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      console.error('Error creating booking:', error);
      res.status(500).json({ error: 'Failed to create booking' });
    }
  });

  // GET /bookings/{id} - Get booking details, plus the ledger/inspection/claim/
  // settlement/delivery/payment state needed to drive the full lifecycle UI
  // (the Ops tab) from a single call instead of many separate endpoints.
  app.get('/bookings/:id', async (req, res) => {
    try {
      const booking = await bookingService.getBookingById(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      const [ledgerEntries, inspections, claims, settlement, payment, deliveryTimeline] = await Promise.all([
        ledgerService.getLedgerEntriesForBooking(booking.id),
        inspectionService.getBookingInspections(booking.id),
        claimService.getClaimsForBooking(booking.id),
        settlementService.getSettlementByBooking(booking.id),
        paymentService.getPaymentByBooking(booking.id),
        deliveryService.getDeliveryTimeline(booking.id),
      ]);

      res.json({
        ...booking,
        ledgerEntries,
        inspections,
        claims,
        settlement,
        payment,
        deliveryTimeline,
      });
    } catch (error) {
      console.error('Error fetching booking:', error);
      res.status(500).json({ error: 'Failed to fetch booking' });
    }
  });

  // POST /bookings/{id}/authorize-payment - Authorize payment via the mock
  // payment provider. No real payment gateway is integrated (by product
  // decision) — instead this drives two self-signed webhook events
  // (payment.authorized, payment.completed) through the same verification +
  // ledger code path a real inbound webhook would use.
  app.post('/bookings/:id/authorize-payment', async (req, res) => {
    try {
      const booking = await bookingService.getBookingById(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      if (booking.status === 'cancelled') {
        return res.status(409).json({ error: 'Cannot authorize payment for a cancelled booking' });
      }

      const payment = await paymentService.authorizeAndConfirmMockPayment(booking.id);

      res.json({
        success: true,
        message: 'Payment authorized and confirmed',
        bookingId: req.params.id,
        payment,
      });
    } catch (error) {
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

      if (booking.status === 'completed') {
        return res.status(409).json({ error: 'Cannot cancel a completed booking' });
      }

      const refundIdempotencyKey = `refund:${booking.id}`;

      if (booking.status === 'cancelled') {
        // Idempotent retry: return the amount locked in at the original
        // cancellation time rather than recomputing against "now" again,
        // which could shift refund tiers if retried much later.
        const existingRefund = await ledgerService.getLedgerEntryByIdempotencyKey(refundIdempotencyKey);
        const refundAmount = existingRefund?.amount ?? 0;
        return res.json({
          success: true,
          refundAmount,
          message: `Booking already cancelled. Refund: ${refundAmount}`,
        });
      }

      const policy = await policyService.getPolicyById(booking.policyVersionId);
      const refundAmount = policyService.calculateRefund(
        booking.totalPrice,
        new Date(),
        booking.startDate,
        policy
      );

      await bookingService.updateBookingStatus(req.params.id, 'cancelled');

      if (refundAmount > 0) {
        await ledgerService.recordLedgerEntry({
          bookingId: booking.id,
          userId: booking.renterId,
          entryType: 'refund',
          amount: refundAmount,
          idempotencyKey: refundIdempotencyKey,
        });
      }

      // Release any held deposit back to the renter — the rental never
      // happened (or was cut short), so nothing can be charged against it.
      const depositHeld = await ledgerService.getLedgerEntryByIdempotencyKey(`deposit_hold:${booking.id}`);
      if (depositHeld) {
        await ledgerService.recordLedgerEntry({
          bookingId: booking.id,
          userId: booking.renterId,
          entryType: 'deposit_release',
          amount: depositHeld.amount,
          idempotencyKey: `deposit_release:${booking.id}`,
        });
      }

      res.json({
        success: true,
        refundAmount,
        message: `Booking cancelled. Refund: ${refundAmount}`,
      });
    } catch (error) {
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
        status: z.enum(['approved', 'rejected']).default('approved'),
        damageClaim: z
          .object({
            damageType: z.string().min(1),
            amount: z.number().positive(),
          })
          .optional(),
      });

      const parsed = schema.parse(req.body);

      const booking = await bookingService.getBookingById(parsed.bookingId);
      if (!booking) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      // Create inspection
      const inspection = await inspectionService.createInspection(
        parsed.bookingId,
        parsed.inspectionType,
        parsed.inspectorId
      );

      // Upload photos
      for (const photoUrl of parsed.photos) {
        await inspectionService.uploadInspectionPhoto(inspection.id, photoUrl);
      }

      // Mark inspection as completed/approved/rejected
      await inspectionService.completeInspection(inspection.id, parsed.status);

      // A rejected inspection with a reported damage opens a claim and moves
      // the booking into claim_resolving, blocking /complete until resolved.
      let claim = null;
      if (parsed.status === 'rejected' && parsed.damageClaim) {
        claim = await claimService.createClaim(
          parsed.bookingId,
          parsed.damageClaim.damageType,
          parsed.damageClaim.amount
        );
        await bookingService.updateBookingStatus(parsed.bookingId, 'claim_resolving');
      }

      res.status(201).json({
        success: true,
        inspectionId: inspection.id,
        photosCount: parsed.photos.length,
        status: parsed.status,
        claim,
      });
    } catch (error) {
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
    } catch (error) {
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

      if (booking.status === 'completed') {
        const existingSettlement = await settlementService.getSettlementByBooking(booking.id);
        return res.json({ success: true, settlement: existingSettlement, message: 'Booking already completed' });
      }

      if (booking.status === 'cancelled') {
        return res.status(409).json({ error: 'Cannot complete a cancelled booking' });
      }

      // Check if inspection is done
      const inspections = await inspectionService.getBookingInspections(req.params.id);
      if (inspections.length === 0) {
        return res.status(400).json({ error: 'Inspection photos required before completing' });
      }

      // Required by TRD AC#8: settlement must never run while a damage claim
      // is unresolved.
      const pendingClaims = await claimService.getPendingClaimsForBooking(req.params.id);
      if (pendingClaims.length > 0) {
        return res.status(409).json({
          error: 'Cannot complete booking while damage claims are unresolved',
          pendingClaims,
        });
      }

      const carrier = await carrierService.getCarrierById(booking.carrierId);
      if (!carrier) {
        return res.status(500).json({ error: 'Carrier for booking not found' });
      }

      await bookingService.updateBookingStatus(req.params.id, 'completed');

      // Calculate + persist settlement (idempotent via settlements.booking_id
      // UNIQUE constraint)
      const policy = await policyService.getPolicyById(booking.policyVersionId);
      const { platformFee, providerPayout } = policyService.calculateSettlement(booking.totalPrice, policy);
      const settlement = await settlementService.createSettlement(
        carrier.providerId,
        booking.id,
        booking.totalPrice,
        platformFee,
        providerPayout
      );

      // Release the deposit minus any approved damage charges (floored at 0).
      const ledgerEntries = await ledgerService.getLedgerEntriesForBooking(booking.id);
      const depositHeld = ledgerEntries.find((entry) => entry.entryType === 'deposit_hold');
      const damageCharged = ledgerEntries
        .filter((entry) => entry.entryType === 'damage_charge')
        .reduce((sum, entry) => sum + entry.amount, 0);
      if (depositHeld) {
        const releaseAmount = Math.max(0, depositHeld.amount - damageCharged);
        if (releaseAmount > 0) {
          await ledgerService.recordLedgerEntry({
            bookingId: booking.id,
            userId: booking.renterId,
            entryType: 'deposit_release',
            amount: releaseAmount,
            idempotencyKey: `deposit_release:${booking.id}`,
          });
        }
      }

      // Record the logistics cost for the (informational) contribution-profit
      // KPI — never used to gate settlement itself.
      await costService.recordCostEntry(
        booking.id,
        'logistics',
        policy.roundTripShipping * PLATFORM_LOGISTICS_COST_RATIO
      );

      res.json({
        success: true,
        settlement,
        message: 'Booking completed',
      });
    } catch (error) {
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

      const claim = await claimService.getClaimById(req.params.id);
      if (!claim) {
        return res.status(404).json({ error: 'Claim not found' });
      }

      if (claim.status !== 'pending') {
        return res.json({ success: true, message: 'Claim already resolved', claim });
      }

      const booking = await bookingService.getBookingById(claim.bookingId);
      const resolved = await claimService.resolveClaim(req.params.id, parsed.status, parsed.resolutionNotes);

      if (parsed.status === 'approved' && resolved) {
        await ledgerService.recordLedgerEntry({
          bookingId: resolved.bookingId,
          userId: booking?.renterId,
          entryType: 'damage_charge',
          amount: resolved.amount,
          idempotencyKey: `damage_charge:${resolved.id}`,
        });
      }

      // Once every claim on the booking is resolved, move it back out of
      // claim_resolving so /complete can be retried.
      if (booking && booking.status === 'claim_resolving') {
        const stillPending = await claimService.getPendingClaimsForBooking(claim.bookingId);
        if (stillPending.length === 0) {
          await bookingService.updateBookingStatus(claim.bookingId, 'inspection_pending');
        }
      }

      res.json({
        success: true,
        message: 'Claim resolved',
        claim: resolved,
      });
    } catch (error) {
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

      await query(
        `INSERT INTO funnel_events (user_id, session_id, event_type, metadata, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [parsed.userId, parsed.sessionId, parsed.eventType, JSON.stringify(parsed.metadata || {})]
      );

      res.status(201).json({ success: true });
    } catch (error) {
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

  // POST /webhooks/payments - Signed payment provider webhook. Requires a
  // valid X-Payment-Signature header (HMAC over the raw body); this is the
  // same verification + handler code the internal mock-provider loop
  // (see POST /bookings/:id/authorize-payment) exercises.
  app.post('/webhooks/payments', async (req, res) => {
    try {
      const rawBody = (req as express.Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
      const result = await paymentService.processPaymentWebhook(rawBody, req.header('X-Payment-Signature'));
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error processing payment webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // POST /webhooks/delivery - Signed delivery-carrier webhook. Requires a
  // valid X-Delivery-Signature header (HMAC over the raw body).
  app.post('/webhooks/delivery', async (req, res) => {
    try {
      const rawBody = (req as express.Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
      const result = await deliveryService.processDeliveryWebhook(rawBody, req.header('X-Delivery-Signature'));
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error processing delivery webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // ============================================================
  // OPS ENDPOINTS (demo/local delivery simulation + photo uploads)
  // ============================================================

  // POST /ops/delivery-events - Simulates a carrier delivery event for local
  // dev/demo/E2E use, since no real logistics provider is integrated. The
  // server signs the event itself (with the same secret /webhooks/delivery
  // verifies against) and routes it through the real signature-verification
  // handler, so this is a trigger for the real pipeline, not a bypass of it.
  app.post('/ops/delivery-events', async (req, res) => {
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

      const result = await deliveryService.simulateDeliveryEvent(parsed.bookingId, parsed.direction, parsed.status);
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      console.error('Error simulating delivery event:', error);
      res.status(500).json({ error: 'Failed to simulate delivery event' });
    }
  });

  // POST /uploads/sign - Issues a short-lived upload target for a photo
  // (intake or inspection). Prefers a real Azure Blob SAS URL when
  // AZURE_STORAGE_CONNECTION_STRING is configured; otherwise falls back to a
  // local-disk adapter with the same sign -> upload -> blobUrl contract.
  app.post('/uploads/sign', (req, res) => {
    try {
      const schema = z.object({
        category: z.enum(['intake', 'inspection']),
        fileName: z.string().min(1),
      });
      const parsed = schema.parse(req.body);
      const signResult = storageService.signUpload(parsed.category, parsed.fileName);
      res.json(signResult);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      console.error('Error signing upload:', error);
      res.status(500).json({ error: 'Failed to sign upload' });
    }
  });

  // POST /uploads/local/:token - Local-disk fallback receiver used only when
  // Azure Blob Storage isn't configured; the client PUTs/POSTs here instead
  // of directly to Azure using the token issued by /uploads/sign.
  app.post('/uploads/local/:token', localUpload.single('file'), (req, res) => {
    try {
      const ticket = storageService.consumeLocalUploadTicket(String(req.params.token));
      if (!ticket) {
        return res.status(400).json({ error: 'Upload token is invalid or expired' });
      }
      const file = (req as express.Request & { file?: Express.Multer.File }).file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const destPath = path.join(storageService.getLocalUploadDir(), ticket.fileName);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, file.buffer);

      const publicBase = process.env.PUBLIC_API_URL || 'http://localhost:3001';
      res.json({ success: true, blobUrl: `${publicBase}/uploads/files/${ticket.fileName}` });
    } catch (error) {
      console.error('Error receiving local upload:', error);
      res.status(500).json({ error: 'Failed to store upload' });
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
      const result = await query(
        `SELECT 
          event_type, 
          COUNT(*) as count 
         FROM funnel_events 
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY event_type
         ORDER BY count DESC`
      );

      res.json({
        period: '24h',
        events: result.rows,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error fetching metrics:', error);
      res.status(500).json({ error: 'Failed to fetch metrics' });
    }
  });

  // GET /metrics/kpi - Aggregated KPI snapshot: OTA funnel conversion,
  // provider opt-in rate, booking completion rate, dispute rate, and
  // (informational) per-booking contribution profit.
  app.get('/metrics/kpi', async (_req, res) => {
    try {
      const snapshot = await metricsService.getKpiSnapshot();
      res.json(snapshot);
    } catch (error) {
      console.error('Error fetching KPI snapshot:', error);
      res.status(500).json({ error: 'Failed to fetch KPI snapshot' });
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
