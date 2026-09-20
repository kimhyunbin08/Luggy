import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { calculateRefundAmount, calculateSettlement, calculateTotalPrice, validateMinimumRentalDays } from './domain/calculators.js';
import { CarrierSize, defaultPolicy } from './domain/policy.js';
import { generateSessionToken, isValidNickname, isValidPhone, normalizePhone } from './domain/auth.js';

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
};

type CarrierItem = {
  id: string;
  ownerId?: string;
  size: CarrierSize;
  brandModel: string;
  dailyPrice: number;
  district: string;
  lat: number;
  lng: number;
  ownerName: string;
  ownerContact: string;
  rating: number;
  reviews: number;
  photoUrl: string;
  description: string;
  available: boolean;
  optIn: boolean;
  remainingQuantity: number;
  originalPrice: number;
};

type ContactRequest = {
  id: string;
  carrierId: string;
  renterId?: string;
  renterName: string;
  renterPhone: string;
  startDate: string;
  endDate: string;
  message: string;
  status: 'pending' | 'accepted' | 'completed' | 'cancelled';
  createdAt: string;
};

type User = {
  id: string;
  nickname: string;
  phone: string;
  createdAt: string;
};

type Review = {
  id: string;
  carrierId: string;
  contactRequestId: string;
  reviewerId?: string;
  reviewerName: string;
  rating: number;
  comment: string;
  createdAt: string;
};

const carriers: CarrierItem[] = [
  { id: 'c1', size: 'carry_on' as CarrierSize, brandModel: '리모와 에센셜 캐빈 (20인치)', dailyPrice: 7900, district: '강남구 역삼동', lat: 37.4979, lng: 127.0276, ownerName: '역삼동이웃', ownerContact: '010-9876-5432', rating: 4.9, reviews: 18, photoUrl: 'https://images.unsplash.com/photo-1565026057447-b88e3f291029?auto=format&fit=crop&w=600&q=80', description: '1회 사용한 깨끗한 리모와 캐리어입니다. 역삼역 3번 출구 근처에서 직거래 가능합니다.', optIn: true, available: true, remainingQuantity: 1, originalPrice: 45000 },
  { id: 'c2', size: 'carry_on' as CarrierSize, brandModel: '샘소나이트 에어로스 20인치', dailyPrice: 7000, district: '서초구 서초동', lat: 37.4918, lng: 127.0079, ownerName: '서초트래블러', ownerContact: '010-8765-4321', rating: 4.8, reviews: 12, photoUrl: 'https://images.unsplash.com/photo-1581553680321-4fffae59febd?auto=format&fit=crop&w=600&q=80', description: '가볍고 튼튼한 샘소나이트 기내용 캐리어입니다. 교대역/서초역 부근 거래 환영합니다.', optIn: true, available: true, remainingQuantity: 1, originalPrice: 35000 },
  { id: 'c3', size: 'medium' as CarrierSize, brandModel: '샘소나이트 시큐리티 24인치 (Medium)', dailyPrice: 11900, district: '마포구 연남동', lat: 37.5623, lng: 126.9242, ownerName: '연남여행자', ownerContact: '010-7654-3210', rating: 4.9, reviews: 24, photoUrl: 'https://images.unsplash.com/photo-1581553680321-4fffae59febd?auto=format&fit=crop&w=600&q=80', description: '유럽 여행 다녀올 때 썼던 24인치 중형 캐리어입니다. 수하물용으로 넉넉합니다.', optIn: true, available: true, remainingQuantity: 1, originalPrice: 50000 },
  { id: 'c4', size: 'medium' as CarrierSize, brandModel: '아메리칸투어리스터 스카이 24인치', dailyPrice: 10000, district: '송파구 잠실동', lat: 37.5133, lng: 127.1001, ownerName: '잠실이웃', ownerContact: '010-6543-2109', rating: 4.7, reviews: 9, photoUrl: 'https://images.unsplash.com/photo-1565026057447-b88e3f291029?auto=format&fit=crop&w=600&q=80', description: '잠실새내역근처 직거래 원합니다. TSA 잠금장치 완비되어 있습니다.', optIn: true, available: true, remainingQuantity: 1, originalPrice: 40000 }
];
const contactRequests: ContactRequest[] = [];
const bookings = new Map<string, Booking>();

// --- Auth (simple phone-based session, no PG/password flow) ---
const users: User[] = [];
const sessions = new Map<string, string>(); // token -> userId
// --- Favorites (찜하기) ---
type Favorite = { id: string; userId: string; carrierId: string; createdAt: string };
const favorites: Favorite[] = [];
// --- Reviews (반납 완료 후 후기) ---
const reviews: Review[] = [];

function findUserByPhone(phone: string): User | undefined {
  return users.find((u) => u.phone === phone);
}

function authenticate(req: Request): User | null {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) return null;
  const userId = sessions.get(token);
  if (!userId) return null;
  return users.find((u) => u.id === userId) || null;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = authenticate(req);
  if (!user) return res.status(401).json({ message: '로그인이 필요합니다.' });
  (req as Request & { user: User }).user = user;
  next();
}

export function createApp() {
  const app = express();
  app.use(express.json());

  // CORS for local web dev
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // ============================================================
  // AUTH ENDPOINTS (phone-based login/signup, no password/PG flow)
  // ============================================================

  app.post('/auth/signup', (req: Request, res: Response) => {
    const schema = z.object({ nickname: z.string(), phone: z.string() });
    const parsed = schema.parse(req.body);
    if (!isValidNickname(parsed.nickname)) {
      return res.status(400).json({ message: '닉네임은 2~20자로 입력해주세요.' });
    }
    if (!isValidPhone(parsed.phone)) {
      return res.status(400).json({ message: '올바른 휴대폰 번호 형식이 아닙니다. (예: 010-1234-5678)' });
    }
    const phone = normalizePhone(parsed.phone);
    if (findUserByPhone(phone)) {
      return res.status(409).json({ message: '이미 가입된 휴대폰 번호입니다. 로그인해주세요.' });
    }
    const user: User = { id: `u${users.length + 1}`, nickname: parsed.nickname.trim(), phone, createdAt: new Date().toISOString() };
    users.push(user);
    const token = generateSessionToken();
    sessions.set(token, user.id);
    res.status(201).json({ token, user });
  });

  app.post('/auth/login', (req: Request, res: Response) => {
    const schema = z.object({ phone: z.string() });
    const parsed = schema.parse(req.body);
    if (!isValidPhone(parsed.phone)) {
      return res.status(400).json({ message: '올바른 휴대폰 번호 형식이 아닙니다.' });
    }
    const phone = normalizePhone(parsed.phone);
    const user = findUserByPhone(phone);
    if (!user) {
      return res.status(404).json({ message: '가입되지 않은 휴대폰 번호입니다. 먼저 가입해주세요.' });
    }
    const token = generateSessionToken();
    sessions.set(token, user.id);
    res.json({ token, user });
  });

  app.post('/auth/logout', requireAuth, (req: Request, res: Response) => {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    sessions.delete(token);
    res.json({ ok: true });
  });

  app.get('/auth/me', requireAuth, (req: Request, res: Response) => {
    res.json({ user: (req as Request & { user: User }).user });
  });

  // ============================================================
  // FAVORITES ENDPOINTS (찜하기)
  // ============================================================

  app.get('/favorites', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { user: User }).user;
    const mine = favorites.filter((f) => f.userId === user.id);
    const items = mine
      .map((f) => carriers.find((c) => c.id === f.carrierId))
      .filter((c): c is CarrierItem => Boolean(c));
    res.json({ favorites: mine, items });
  });

  app.post('/favorites', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { user: User }).user;
    const schema = z.object({ carrierId: z.string() });
    const parsed = schema.parse(req.body);
    const carrier = carriers.find((c) => c.id === parsed.carrierId);
    if (!carrier) return res.status(404).json({ message: 'carrier not found' });
    const existing = favorites.find((f) => f.userId === user.id && f.carrierId === parsed.carrierId);
    if (existing) return res.status(200).json({ ok: true, favorite: existing });
    const favorite: Favorite = { id: `fav${favorites.length + 1}`, userId: user.id, carrierId: parsed.carrierId, createdAt: new Date().toISOString() };
    favorites.push(favorite);
    res.status(201).json({ ok: true, favorite });
  });

  app.delete('/favorites/:carrierId', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { user: User }).user;
    const carrierId = Array.isArray(req.params.carrierId) ? req.params.carrierId[0] : req.params.carrierId;
    const idx = favorites.findIndex((f) => f.userId === user.id && f.carrierId === carrierId);
    if (idx === -1) return res.status(404).json({ message: 'favorite not found' });
    favorites.splice(idx, 1);
    res.json({ ok: true });
  });

  // ============================================================
  // REVIEW ENDPOINTS (반납 완료 후 후기 작성)
  // ============================================================

  app.get('/carriers/:id/reviews', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const items = reviews.filter((r) => r.carrierId === id);
    res.json({ reviews: items });
  });

  app.post('/carriers/:id/reviews', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const carrier = carriers.find((c) => c.id === id);
    if (!carrier) return res.status(404).json({ message: 'carrier not found' });

    const schema = z.object({
      contactRequestId: z.string(),
      reviewerName: z.string().default('익명 이웃'),
      rating: z.number().min(1).max(5),
      comment: z.string().default('')
    });
    const parsed = schema.parse(req.body);
    const contactRequest = contactRequests.find((r) => r.id === parsed.contactRequestId);
    if (!contactRequest || contactRequest.carrierId !== id) {
      return res.status(404).json({ message: 'contact request not found for this carrier' });
    }
    if (contactRequest.status !== 'completed') {
      return res.status(400).json({ message: '반납 완료된 거래에만 후기를 작성할 수 있습니다.' });
    }
    if (reviews.some((r) => r.contactRequestId === parsed.contactRequestId)) {
      return res.status(409).json({ message: '이미 이 거래에 대한 후기를 작성했습니다.' });
    }

    const maybeUser = authenticate(req);
    const review: Review = {
      id: `rev${reviews.length + 1}`,
      carrierId: id,
      contactRequestId: parsed.contactRequestId,
      reviewerId: maybeUser?.id,
      reviewerName: maybeUser?.nickname || parsed.reviewerName,
      rating: parsed.rating,
      comment: parsed.comment,
      createdAt: new Date().toISOString()
    };
    reviews.push(review);

    // Keep the carrier's aggregate rating/review-count in sync for search/detail views.
    const carrierReviews = reviews.filter((r) => r.carrierId === id);
    carrier.reviews = carrierReviews.length;
    carrier.rating = Number((carrierReviews.reduce((sum, r) => sum + r.rating, 0) / carrierReviews.length).toFixed(1));

    res.status(201).json({ ok: true, review, carrier });
  });

  app.get('/renters/search', (req: Request, res: Response) => {
    const size = req.query.size as CarrierSize | undefined;
    const district = req.query.district as string | undefined;
    const q = ((req.query.q as string) || '').toLowerCase();
    const startDateStr = (req.query.startDate as string) || '2026-08-10';
    const endDateStr = (req.query.endDate as string) || '2026-08-12';
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    let filtered = carriers.filter((c) => c.optIn && c.available);

    if (size) {
      filtered = filtered.filter((c) => c.size === size);
    }
    if (district) {
      filtered = filtered.filter((c) => c.district.includes(district));
    }
    if (q) {
      filtered = filtered.filter(
        (c) =>
          c.brandModel.toLowerCase().includes(q) ||
          c.district.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q))
      );
    }

    const sort = (req.query.sort as string) || 'recommended';

    let result = filtered.map((c) => ({
      id: c.id,
      size: c.size,
      brandModel: c.brandModel,
      dailyPrice: c.dailyPrice || (c.size === 'carry_on' ? 7900 : 11900),
      district: c.district || '서울시 강남구',
      lat: c.lat || 37.4979,
      lng: c.lng || 127.0276,
      ownerName: c.ownerName || '희망이웃',
      ownerContact: c.ownerContact || '010-0000-0000',
      rating: c.rating,
      reviews: c.reviews,
      photoUrl:
        c.photoUrl ||
        (c.size === 'carry_on'
          ? 'https://images.unsplash.com/photo-1565026057447-b88e3f291029?auto=format&fit=crop&w=400&q=80'
          : 'https://images.unsplash.com/photo-1581553680321-4fffae59febd?auto=format&fit=crop&w=400&q=80'),
      thumbnail:
        c.photoUrl ||
        (c.size === 'carry_on'
          ? 'https://images.unsplash.com/photo-1565026057447-b88e3f291029?auto=format&fit=crop&w=400&q=80'
          : 'https://images.unsplash.com/photo-1581553680321-4fffae59febd?auto=format&fit=crop&w=400&q=80'),
      description: c.description || '상세설명 참조',
      inspectionBadge: true,
      scarcity: `잔여 ${c.remainingQuantity}개`,
      originalPrice: c.originalPrice,
      totalPrice: calculateTotalPrice(c.size, start, end, defaultPolicy),
      remainingQuantity: c.remainingQuantity
    }));

    if (sort === 'price_asc') {
      result.sort((a, b) => a.dailyPrice - b.dailyPrice);
    } else if (sort === 'price_desc') {
      result.sort((a, b) => b.dailyPrice - a.dailyPrice);
    } else if (sort === 'rating_desc') {
      result.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }

    res.json({ sort, items: result });
  });

  app.get('/carriers/:id', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const carrier = carriers.find((c) => c.id === id);
    if (!carrier) return res.status(404).json({ message: 'not found' });
    res.json(carrier);
  });

  app.post('/contact-requests', (req: Request, res: Response) => {
    const maybeUser = authenticate(req);
    const schema = z.object({
      carrierId: z.string(),
      renterName: z.string().optional(),
      renterPhone: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      message: z.string().default('대여 문의 드립니다.')
    });
    const parsed = schema.parse(req.body);
    const carrier = carriers.find((c) => c.id === parsed.carrierId);
    if (!carrier) return res.status(404).json({ message: 'carrier not found' });

    const id = `req_${contactRequests.length + 1}`;
    const newReq: ContactRequest = {
      id,
      carrierId: parsed.carrierId,
      renterId: maybeUser?.id,
      renterName: maybeUser?.nickname || parsed.renterName || '대여자',
      renterPhone: maybeUser?.phone || parsed.renterPhone || '010-1234-5678',
      startDate: parsed.startDate || '2026-08-10',
      endDate: parsed.endDate || '2026-08-12',
      message: parsed.message,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    contactRequests.push(newReq);
    res.status(201).json({
      ok: true,
      contactRequest: newReq,
      ownerInfo: {
        ownerName: carrier.ownerName,
        ownerContact: carrier.ownerContact,
        district: carrier.district
      }
    });
  });

  app.get('/contact-requests', (req: Request, res: Response) => {
    const maybeUser = authenticate(req);
    if (!maybeUser) return res.json({ requests: contactRequests });
    // Scoped view: requests I sent as a renter, or requests received on carriers I own.
    const myCarrierIds = new Set(carriers.filter((c) => c.ownerId === maybeUser.id).map((c) => c.id));
    const mine = contactRequests.filter((r) => r.renterId === maybeUser.id || myCarrierIds.has(r.carrierId));
    res.json({ requests: mine });
  });

  app.post('/contact-requests/:id/status', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const reqItem = contactRequests.find((r) => r.id === id);
    if (!reqItem) return res.status(404).json({ message: 'contact request not found' });

    const schema = z.object({
      status: z.enum(['pending', 'accepted', 'completed', 'cancelled'])
    });
    const parsed = schema.parse(req.body);
    reqItem.status = parsed.status;
    res.json({ ok: true, contactRequest: reqItem });
  });

  app.post('/bookings', (req: Request, res: Response) => {
    const schema = z.object({
      carrierId: z.string(),
      size: z.enum(['carry_on', 'medium']),
      startDate: z.string(),
      endDate: z.string()
    });
    const parsed = schema.parse(req.body);
    const start = new Date(parsed.startDate);
    const end = new Date(parsed.endDate);
    if (!validateMinimumRentalDays(start, end, defaultPolicy)) {
      return res.status(400).json({ message: 'minimum rental days is 2' });
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
      inspectionPhotos: []
    };
    bookings.set(id, booking);
    res.status(201).json(booking);
  });

  app.get('/bookings/:id', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const booking = bookings.get(id);
    if (!booking) return res.status(404).json({ message: 'not found' });
    res.json(booking);
  });

  app.post('/bookings/:id/authorize-payment', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const booking = bookings.get(id);
    if (!booking) return res.status(404).json({ message: 'not found' });
    booking.status = 'payment_authorized';
    res.json({ ok: true, booking });
  });

  app.post('/bookings/:id/cancel', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const booking = bookings.get(id);
    if (!booking) return res.status(404).json({ message: 'not found' });
    const hoursBeforePickup = Number(req.body?.hoursBeforePickup ?? 0);
    const refundAmount = calculateRefundAmount(booking.totalPrice, hoursBeforePickup, defaultPolicy);
    booking.status = 'cancelled';
    res.json({ refundAmount });
  });

  app.post('/providers/carriers', (req: Request, res: Response) => {
    const maybeUser = authenticate(req);
    const id = `c${carriers.length + 1}`;
    const size = (req.body?.size as CarrierSize) || 'carry_on';
    const brandModel = req.body?.brandModel || (size === 'carry_on' ? '이웃 등록 기내용 캐리어' : '이웃 등록 중형 캐리어');
    const district = req.body?.district || '강남구 역삼동';
    const dailyPrice = Number(req.body?.dailyPrice) || (size === 'carry_on' ? 7900 : 11900);
    const ownerName = req.body?.ownerName || maybeUser?.nickname || '새이웃';
    const ownerContact = req.body?.ownerContact || maybeUser?.phone || '010-1111-2222';
    const description = req.body?.description || '소유자가 직접 등록한 대여 가능 캐리어입니다.';
    const lat = Number(req.body?.lat) || 37.5000;
    const lng = Number(req.body?.lng) || 127.0300;
    const photoUrl =
      req.body?.photoUrl ||
      (size === 'carry_on'
        ? 'https://images.unsplash.com/photo-1565026057447-b88e3f291029?auto=format&fit=crop&w=600&q=80'
        : 'https://images.unsplash.com/photo-1581553680321-4fffae59febd?auto=format&fit=crop&w=600&q=80');

    const newCarrier: CarrierItem = {
      id,
      ownerId: maybeUser?.id,
      size,
      brandModel,
      dailyPrice,
      district,
      lat,
      lng,
      ownerName,
      ownerContact,
      rating: 5.0,
      reviews: 0,
      photoUrl,
      description,
      optIn: true,
      available: true,
      remainingQuantity: 1,
      originalPrice: size === 'carry_on' ? 38000 : 48000
    };
    carriers.push(newCarrier);
    res.status(201).json({ id, carrier: newCarrier });
  });

  app.get('/providers/me/carriers', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { user: User }).user;
    const mine = carriers.filter((c) => c.ownerId === user.id);
    res.json({ items: mine });
  });

  app.post('/providers/carriers/:id/opt-in', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const carrier = carriers.find((c) => c.id === id);
    if (!carrier) return res.status(404).json({ message: 'not found' });
    carrier.optIn = true;
    res.json({ ok: true });
  });

  app.post('/inspections', (req: Request, res: Response) => {
    const schema = z.object({ bookingId: z.string(), photos: z.array(z.string()).min(1) });
    const parsed = schema.parse(req.body);
    const booking = bookings.get(parsed.bookingId);
    if (!booking) return res.status(404).json({ message: 'not found' });
    booking.inspectionPhotos = parsed.photos;
    booking.status = 'inspection_pending';
    res.status(201).json({ ok: true });
  });

  app.post('/bookings/:id/complete', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const booking = bookings.get(id);
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

  app.post('/claims/:id/resolve', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/funnel/events', (_req: Request, res: Response) => res.status(201).json({ ok: true }));

  app.post('/webhooks/payments', (_req: Request, res: Response) => res.json({ ok: true }));

  app.post('/webhooks/delivery', (req: Request, res: Response) => {
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

// Only auto-start when this file is executed directly (e.g. `node dist/server.js`).
// `dev.ts` imports `createApp` and manages its own `listen()` call, so this guard
// prevents a duplicate listener / EADDRINUSE conflict during local dev.
const isDirectEntry = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectEntry && process.env.NODE_ENV !== 'test') {
  const app = createApp();
  const port = Number(process.env.PORT) || 3001;
  app.listen(port, () => {
    // noop
  });
}
