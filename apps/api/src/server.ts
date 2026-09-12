import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { calculateRefundAmount, calculateSettlement, calculateTotalPrice, validateMinimumRentalDays } from './domain/calculators.js';
import { CarrierSize, defaultPolicy } from './domain/policy.js';

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
  renterName: string;
  renterPhone: string;
  startDate: string;
  endDate: string;
  message: string;
  status: 'pending' | 'accepted' | 'completed' | 'cancelled';
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

export function createApp() {
  const app = express();
  app.use(express.json());

  // CORS for local web dev
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') return res.sendStatus(200);
    next();
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

    const result = filtered.map((c) => ({
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
    res.json({ sort: req.query.sort || 'recommended', items: result });
  });

  app.get('/carriers/:id', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const carrier = carriers.find((c) => c.id === id);
    if (!carrier) return res.status(404).json({ message: 'not found' });
    res.json(carrier);
  });

  app.post('/contact-requests', (req: Request, res: Response) => {
    const schema = z.object({
      carrierId: z.string(),
      renterName: z.string().default('대여자'),
      renterPhone: z.string().default('010-1234-5678'),
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
      renterName: parsed.renterName,
      renterPhone: parsed.renterPhone,
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

  app.get('/contact-requests', (_req: Request, res: Response) => {
    res.json({ requests: contactRequests });
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
    const id = `c${carriers.length + 1}`;
    const size = (req.body?.size as CarrierSize) || 'carry_on';
    const brandModel = req.body?.brandModel || (size === 'carry_on' ? '이웃 등록 기내용 캐리어' : '이웃 등록 중형 캐리어');
    const district = req.body?.district || '강남구 역삼동';
    const dailyPrice = Number(req.body?.dailyPrice) || (size === 'carry_on' ? 7900 : 11900);
    const ownerName = req.body?.ownerName || '새이웃';
    const ownerContact = req.body?.ownerContact || '010-1111-2222';
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

if (process.env.NODE_ENV !== 'test') {
  const app = createApp();
  app.listen(3001, () => {
    // noop
  });
}
