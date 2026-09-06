import "./styles.css";
import { shouldDisableBookingCTA } from "./funnel.js";
import { initP2pTab, stopP2pTab, renderP2pTab, bindP2pEvents } from "./p2p.js";

type Size = "carry_on" | "medium";
type Tab = "rent" | "provider" | "ops" | "p2p";
type Step = 1 | 2 | 3;
type DeliveryDirection = "outbound" | "return";
type DeliveryStatus = "in_transit" | "arrived" | "delayed";
type InspectionType = "intake" | "outbound" | "return";

type Carrier = {
  id: string;
  size: Size;
  brandModel: string;
  basePrice?: number;
  thumbnailUrl?: string;
  intakePhotoUrl?: string;
  inspectionBadge?: string;
  totalPrice: number;
  eta: string;
  remainingQuantity: number;
  status?: string;
  optInRentable?: boolean;
  city?: string;
  provider: {
    id: string;
    rating: number;
    reviews: number;
  };
};

type BookingRequest = {
  renterId: string;
  carrierId: string;
  startDate: string;
  endDate: string;
  idempotencyKey?: string;
  sessionId?: string;
};

type LedgerEntry = {
  id: string;
  entryType: string;
  amount: number;
  createdAt: string;
};

type DeliveryEvent = {
  id: string;
  direction: DeliveryDirection;
  status: string;
  createdAt: string;
};

type InspectionRecord = {
  id: string;
  inspectionType: string;
  status: string;
  createdAt: string;
};

type ClaimRecord = {
  id: string;
  bookingId: string;
  damageType: string;
  amount: number;
  status: string;
  resolutionNotes?: string;
};

type SettlementRecord = {
  id: string;
  grossAmount: number;
  platformFee: number;
  providerPayout: number;
  status: string;
} | null;

type PaymentRecord = {
  id: string;
  amount: number;
  depositAmount?: number;
  status: string;
  provider?: string;
} | null;

type OpsBooking = {
  id: string;
  status: string;
  deliveryStatus: string;
  totalPrice: number;
  startDate: string;
  endDate: string;
  renterId: string;
  carrierId: string;
  ledgerEntries: LedgerEntry[];
  inspections: InspectionRecord[];
  claims: ClaimRecord[];
  settlement: SettlementRecord;
  payment: PaymentRecord;
  deliveryTimeline: DeliveryEvent[];
};

type KpiSnapshot = {
  funnel: {
    landing: number;
    search: number;
    detail: number;
    checkout: number;
    paid: number;
    conversion: {
      landingToSearch: number;
      searchToDetail: number;
      detailToCheckout: number;
      checkoutToPaid: number;
      landingToPaid: number;
    };
  };
  bookingsByStatus: Record<string, number>;
  providerOptInRate: number;
  bookingCompletionRate: number;
  disputeRate: number;
  avgContributionProfitPerBooking: number | null;
  generatedAt: string;
};

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const MOCK_RENTER_ID = "550e8400-e29b-41d4-a716-446655440000";
const MOCK_PROVIDER_ID = "550e8400-e29b-41d4-a716-446655440001";
const DISPLAY_POLICY = {
  minRentalDays: 2,
  dailyPrice: {
    carry_on: 7900,
    medium: 11900,
  },
  roundTripShipping: 14000,
} as const;
const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const state = {
  tab: "rent" as Tab,
  step: 1 as Step,
  startDate: futureDate(7),
  endDate: futureDate(9),
  size: "carry_on" as Size,
  // Selected city filter for renter search ("" = 전체 도시 / no filter, keeps
  // default search behavior unchanged). availableCities is populated from
  // GET /carriers/cities and drives the <select> options.
  searchCity: "",
  availableCities: [] as string[],
  sort: "recommended",
  searchResults: [] as Carrier[],
  selectedCarrierId: "",
  customerName: "",
  customerPhone: "",
  loading: false,
  error: "",
  notice: "",
  bookingId: "",
  paymentAuthorized: false,
  bookingCancelled: false,
  cancelRefundAmount: null as number | null,
  providerSize: "carry_on" as Size,
  providerCity: "서울",
  providerBrand: "",
  providerModel: "",
  providerBasePrice: 0,
  providerPhotoUrl: "",
  providerPhotoUploading: false,
  providerOptIn: true,
  providerCarriers: [] as Carrier[],

  // Ops console (booking lifecycle management + KPI dashboard)
  opsBookingIdInput: "",
  opsBooking: null as OpsBooking | null,
  opsKpi: null as KpiSnapshot | null,
  opsLoading: false,
  opsError: "",
  opsNotice: "",
  opsDeliveryDirection: "outbound" as DeliveryDirection,
  opsDeliveryStatus: "in_transit" as DeliveryStatus,
  opsInspectionType: "return" as InspectionType,
  opsInspectionApproved: true,
  opsDamageType: "",
  opsDamageAmount: 0,
  opsInspectionPhotoUrl: "",
  opsInspectionUploading: false,
  opsResolveNotes: "",
};

function futureDate(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function currency(value: number | string): string {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}.${month}.${day}` : value;
}

function sizeLabel(size: Size): string {
  return size === "carry_on" ? "기내용" : "중형";
}

const BOOKING_STATUS_LABEL: Record<string, string> = {
  requested: "요청됨",
  payment_method_saved: "결제수단 저장됨",
  payment_authorized: "결제 승인됨",
  confirmed: "예약 확정",
  outbound_in_transit: "배송 중 (출고)",
  in_use: "사용 중",
  return_in_transit: "배송 중 (반납)",
  inspection_pending: "검수 대기",
  claim_resolving: "클레임 처리 중",
  completed: "완료",
  cancelled: "취소됨",
  overdue: "연체",
  lost: "분실",
  disputed: "분쟁",
};

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  in_transit: "배송 중",
  arrived: "도착",
  delayed: "지연",
};

const LEDGER_ENTRY_LABEL: Record<string, string> = {
  charge: "결제",
  refund: "환불",
  deposit_hold: "보증금 홀드",
  deposit_release: "보증금 해제",
  damage_charge: "손상 청구",
};

const CLAIM_STATUS_LABEL: Record<string, string> = {
  pending: "대기 중",
  approved: "승인됨",
  rejected: "반려됨",
  resolved: "해결됨",
};

function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character] || character);
}

function selectedCarrier(): Carrier | undefined {
  return state.searchResults.find((carrier) => carrier.id === state.selectedCarrierId);
}

function normalizeCarrier(
  raw: Record<string, unknown>,
  rentalDays: number = DISPLAY_POLICY.minRentalDays,
): Carrier {
  const size = (raw.size || "carry_on") as Size;
  const provider = (raw.provider || {}) as Record<string, unknown>;
  const totalPrice = Number(
    raw.totalPrice ||
      raw.gross_amount_won ||
      DISPLAY_POLICY.dailyPrice[size] * rentalDays + DISPLAY_POLICY.roundTripShipping,
  );

  return {
    id: String(raw.id || ""),
    size,
    brandModel: String(raw.brandModel || raw.brand_model || ""),
    basePrice: Number(raw.basePrice || raw.base_price || raw.base_price_won || 0),
    thumbnailUrl: String(raw.thumbnailUrl || raw.thumbnail || raw.intake_photo_url || ""),
    intakePhotoUrl: String(raw.intakePhotoUrl || raw.intake_photo_url || ""),
    inspectionBadge:
      raw.inspectionBadge === true
        ? "검수 완료"
        : String(raw.inspectionBadge || "검수 사진 확인"),
    totalPrice,
    eta: String(raw.eta || "내일 도착"),
    remainingQuantity: Number(raw.remainingQuantity || raw.remaining_quantity || raw.quantity || 1),
    status: String(raw.status || ""),
    optInRentable: Boolean(raw.optInRentable ?? raw.is_opted_in),
    city: String(raw.city || ""),
    provider: {
      id: String(provider.id || raw.provider_id || ""),
      rating: Number(provider.rating || raw.rating || 4.8),
      reviews: Number(provider.reviews || raw.reviews || 42),
    },
  };
}

function rentalCharge(carrier: Carrier): number {
  return Math.max(0, Number(carrier.totalPrice) - DISPLAY_POLICY.roundTripShipping);
}

function canSearch(): boolean {
  return daysBetween(state.startDate, state.endDate) >= DISPLAY_POLICY.minRentalDays;
}

function canContinueToDetails(): boolean {
  const carrier = selectedCarrier();
  return Boolean(
    carrier &&
      canSearch() &&
      !shouldDisableBookingCTA(Number(carrier.remainingQuantity)),
  );
}

function canContinueToPayment(): boolean {
  return (
    canContinueToDetails() &&
    state.customerName.trim().length > 1 &&
    state.customerPhone.replace(/\D/g, "").length >= 8
  );
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null);
  return new Error(payload?.error || fallback);
}

async function logFunnelEvent(
  eventType: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await fetch(`${API_URL}/funnel/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, sessionId, metadata }),
    });
  } catch (error) {
    console.error("[Analytics] Failed to log event:", eventType, error);
  }
}

async function searchCarriers(): Promise<void> {
  if (!canSearch() || state.loading) return;

  state.loading = true;
  state.error = "";
  state.notice = "";
  state.searchResults = [];
  state.selectedCarrierId = "";
  state.step = 1;
  state.bookingId = "";
  state.paymentAuthorized = false;
  state.bookingCancelled = false;
  state.cancelRefundAmount = null;
  render();

  try {
    const url = new URL(`${API_URL}/renters/search`);
    url.searchParams.set("size", state.size);
    url.searchParams.set("start_date", state.startDate);
    url.searchParams.set("end_date", state.endDate);
    url.searchParams.set("sort", state.sort);
    if (state.searchCity) {
      url.searchParams.set("city", state.searchCity);
    }

    const response = await fetch(url.toString());
    if (!response.ok) throw await responseError(response, "검색에 실패했습니다.");

    const rentalDays = daysBetween(state.startDate, state.endDate);
    const data = await response.json();
    const rawItems = Array.isArray(data) ? data : data.items || [];
    state.searchResults = (rawItems as Record<string, unknown>[]).map((item) =>
      normalizeCarrier(item, rentalDays),
    );

    void logFunnelEvent("search_submit", {
      size: state.size,
      days: rentalDays,
      resultCount: state.searchResults.length,
      sort: state.sort,
    });
    void logFunnelEvent("result_view", {
      size: state.size,
      itemCount: state.searchResults.length,
    });
  } catch (error) {
    state.error = `검색 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Search] Error:", error);
  } finally {
    state.loading = false;
    render();
  }
}

// Populates state.availableCities with cities that currently have rentable
// inventory for the active size/date filters (GET /carriers/cities), so the
// renter city <select> only ever lists cities that actually have carriers
// ("캐리어가 있는 도시"), never a hardcoded list. Called on initial load and
// whenever size/date search inputs change.
async function fetchAvailableCities(): Promise<void> {
  if (!canSearch()) return;

  try {
    const url = new URL(`${API_URL}/carriers/cities`);
    url.searchParams.set("size", state.size);
    url.searchParams.set("start_date", state.startDate);
    url.searchParams.set("end_date", state.endDate);

    const response = await fetch(url.toString());
    if (!response.ok) throw await responseError(response, "도시 목록을 불러오지 못했습니다.");

    const data = await response.json();
    state.availableCities = Array.isArray(data.cities) ? data.cities : [];
    if (state.searchCity && !state.availableCities.includes(state.searchCity)) {
      state.searchCity = "";
    }
  } catch (error) {
    console.error("[Cities] Failed to fetch available cities:", error);
  }
}

async function createBooking(): Promise<void> {
  if (!canContinueToPayment() || state.loading) return;

  const carrier = selectedCarrier();
  if (!carrier) return;

  state.loading = true;
  state.error = "";
  state.notice = "";
  state.bookingId = "";
  state.paymentAuthorized = false;
  state.bookingCancelled = false;
  state.cancelRefundAmount = null;
  render();

  try {
    const request: BookingRequest = {
      renterId: MOCK_RENTER_ID,
      carrierId: carrier.id,
      startDate: state.startDate,
      endDate: state.endDate,
      idempotencyKey: `booking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
    };
    const response = await fetch(`${API_URL}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw await responseError(response, "예약 생성에 실패했습니다.");

    const booking = await response.json();
    state.bookingId = booking.id;
    void logFunnelEvent("checkout_step3", { step: 3, bookingId: booking.id });
  } catch (error) {
    state.error = `예약 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Booking] Error:", error);
  } finally {
    state.loading = false;
    render();
  }
}

async function authorizePayment(): Promise<void> {
  if (!state.bookingId || state.loading) return;

  state.loading = true;
  state.error = "";
  state.notice = "";
  render();

  try {
    const response = await fetch(`${API_URL}/bookings/${state.bookingId}/authorize-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw await responseError(response, "결제 승인에 실패했습니다.");

    state.paymentAuthorized = true;
    state.notice = "결제가 승인되었습니다. 배송 준비가 시작됩니다.";
    void logFunnelEvent("paid", {
      bookingId: state.bookingId,
      total: selectedCarrier()?.totalPrice,
      carrierId: state.selectedCarrierId,
    });
  } catch (error) {
    state.error = `결제 승인 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Payment] Error:", error);
  } finally {
    state.loading = false;
    render();
  }
}

async function cancelCurrentBooking(): Promise<void> {
  if (!state.bookingId || state.loading || state.bookingCancelled) return;

  state.loading = true;
  state.error = "";
  state.notice = "";
  render();

  try {
    const response = await fetch(`${API_URL}/bookings/${state.bookingId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw await responseError(response, "예약 취소에 실패했습니다.");

    const result = await response.json();
    state.bookingCancelled = true;
    state.cancelRefundAmount = Number(result.refundAmount || 0);
    void logFunnelEvent("booking_cancelled", {
      bookingId: state.bookingId,
      refundAmount: state.cancelRefundAmount,
    });
  } catch (error) {
    state.error = `예약 취소 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Cancel] Error:", error);
  } finally {
    state.loading = false;
    render();
  }
}

/**
 * Uploads a photo through the real sign -> transfer -> blobUrl flow. Works
 * against either transport /uploads/sign issues: a direct HTTPS PUT to an
 * Azure Blob SAS URL when AZURE_STORAGE_CONNECTION_STRING is configured on
 * the API, or a multipart POST to our own API's local-disk fallback
 * otherwise. The caller only ever sees the resulting blobUrl.
 */
async function uploadPhoto(file: File, category: "intake" | "inspection"): Promise<string> {
  const signResponse = await fetch(`${API_URL}/uploads/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, fileName: file.name || "photo.jpg" }),
  });
  if (!signResponse.ok) throw await responseError(signResponse, "업로드 서명 발급에 실패했습니다.");
  const sign = await signResponse.json();

  if (sign.mode === "azure-sas") {
    const putResponse = await fetch(sign.uploadUrl, {
      method: sign.uploadMethod || "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!putResponse.ok) throw new Error("사진 업로드에 실패했습니다.");
    return String(sign.blobUrl);
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "photo.jpg");
  const uploadResponse = await fetch(sign.uploadUrl, {
    method: sign.uploadMethod || "POST",
    body: formData,
  });
  if (!uploadResponse.ok) throw await responseError(uploadResponse, "사진 업로드에 실패했습니다.");
  const uploaded = await uploadResponse.json();
  return String(uploaded.blobUrl);
}

async function registerCarrier(): Promise<void> {
  if (!state.providerBrand.trim() || !state.providerModel.trim() || state.providerBasePrice <= 0) {
    state.error = "브랜드, 모델, 기준가를 모두 입력해주세요.";
    state.notice = "";
    render();
    return;
  }

  state.loading = true;
  state.error = "";
  state.notice = "";
  render();

  try {
    // Registration and opt-in are sent as a single atomic request (rather
    // than create-then-opt-in as two separate calls) so a dropped/failed
    // second call can no longer leave a carrier permanently stuck at
    // intake_pending with no way to tell it happened.
    const response = await fetch(`${API_URL}/providers/carriers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: MOCK_PROVIDER_ID,
        size: state.providerSize,
        brandModel: `${state.providerBrand.trim()} ${state.providerModel.trim()}`,
        basePrice: state.providerBasePrice,
        intakePhotoUrl: state.providerPhotoUrl || undefined,
        city: state.providerCity.trim() || "서울",
        optInRentable: state.providerOptIn,
      }),
    });
    if (!response.ok) throw await responseError(response, "캐리어 등록에 실패했습니다.");

    state.providerBrand = "";
    state.providerModel = "";
    state.providerBasePrice = 0;
    state.providerPhotoUrl = "";
    state.notice = state.providerOptIn
      ? "캐리어가 등록되고 렌탈 허용 상태로 전환되었습니다."
      : "캐리어가 입고 신청되었습니다.";
  } catch (error) {
    state.error = `등록 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Provider] Error:", error);
  } finally {
    state.loading = false;
    // Always refresh, even on failure: the create call may have actually
    // succeeded server-side, so the list must reflect true state rather than
    // silently hiding a carrier the user can't otherwise see.
    await fetchProviderCarriers();
    render();
  }
}

// Recovery path for carriers left at optInRentable=false for any reason
// (e.g. an old two-step registration whose opt-in call never completed).
// Lets a provider self-serve the fix from "내 캐리어" instead of being stuck.
async function retryOptIn(carrierId: string): Promise<void> {
  state.loading = true;
  state.error = "";
  state.notice = "";
  render();

  try {
    const response = await fetch(`${API_URL}/providers/carriers/${carrierId}/opt-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) throw await responseError(response, "렌탈 허용 전환에 실패했습니다.");
    state.notice = "렌탈 허용 상태로 전환되었습니다.";
  } catch (error) {
    state.error = `전환 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Provider] Opt-in retry error:", error);
  } finally {
    state.loading = false;
    await fetchProviderCarriers();
    render();
  }
}

async function fetchProviderCarriers(): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/providers/${MOCK_PROVIDER_ID}/carriers`);
    if (!response.ok) throw await responseError(response, "내 캐리어를 불러오지 못했습니다.");
    const data = await response.json();
    const rawItems = Array.isArray(data) ? data : data.carriers || [];
    state.providerCarriers = (rawItems as Record<string, unknown>[]).map((item) =>
      normalizeCarrier(item),
    );
  } catch (error) {
    console.error("[Provider] Failed to fetch carriers:", error);
  }
}

async function fetchOpsKpi(): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/metrics/kpi`);
    if (!response.ok) throw await responseError(response, "KPI 조회에 실패했습니다.");
    state.opsKpi = (await response.json()) as KpiSnapshot;
  } catch (error) {
    console.error("[Ops] Failed to fetch KPI:", error);
  }
}

async function fetchOpsBooking(): Promise<void> {
  const bookingId = state.opsBookingIdInput.trim();
  if (!bookingId || state.opsLoading) return;

  state.opsLoading = true;
  state.opsError = "";
  state.opsNotice = "";
  render();

  try {
    const response = await fetch(`${API_URL}/bookings/${bookingId}`);
    if (!response.ok) throw await responseError(response, "예약 조회에 실패했습니다.");
    state.opsBooking = (await response.json()) as OpsBooking;
  } catch (error) {
    state.opsBooking = null;
    state.opsError = `조회 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Ops] Failed to fetch booking:", error);
  } finally {
    state.opsLoading = false;
    render();
  }
}

// Re-fetches the currently loaded booking after a lifecycle action, without
// disturbing the loading/error state of a fresh lookup-by-id.
async function refreshOpsBooking(): Promise<void> {
  if (!state.opsBooking) return;
  try {
    const response = await fetch(`${API_URL}/bookings/${state.opsBooking.id}`);
    if (response.ok) state.opsBooking = (await response.json()) as OpsBooking;
  } catch (error) {
    console.error("[Ops] Failed to refresh booking:", error);
  }
}

async function cancelOpsBooking(): Promise<void> {
  if (!state.opsBooking || state.opsLoading) return;
  state.opsLoading = true;
  state.opsError = "";
  state.opsNotice = "";
  render();

  try {
    const response = await fetch(`${API_URL}/bookings/${state.opsBooking.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw await responseError(response, "예약 취소에 실패했습니다.");
    const result = await response.json();
    state.opsNotice = `예약이 취소되었습니다. 환불액 ${currency(result.refundAmount || 0)}`;
    await refreshOpsBooking();
  } catch (error) {
    state.opsError = `취소 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Ops] Cancel error:", error);
  } finally {
    state.opsLoading = false;
    render();
  }
}

async function simulateOpsDelivery(): Promise<void> {
  if (!state.opsBooking || state.opsLoading) return;
  state.opsLoading = true;
  state.opsError = "";
  state.opsNotice = "";
  render();

  try {
    const response = await fetch(`${API_URL}/ops/delivery-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: state.opsBooking.id,
        direction: state.opsDeliveryDirection,
        status: state.opsDeliveryStatus,
      }),
    });
    if (!response.ok) throw await responseError(response, "배송 이벤트 처리에 실패했습니다.");
    state.opsNotice =
      state.opsDeliveryStatus === "delayed"
        ? "배송 지연 이벤트가 반영되었습니다. 지연 보상이 원장에 기록됩니다."
        : "배송 상태가 갱신되었습니다.";
    await refreshOpsBooking();
  } catch (error) {
    state.opsError = `배송 이벤트 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Ops] Delivery simulation error:", error);
  } finally {
    state.opsLoading = false;
    render();
  }
}

async function submitOpsInspection(): Promise<void> {
  if (!state.opsBooking || state.opsLoading || state.opsInspectionUploading) return;
  if (!state.opsInspectionPhotoUrl) {
    state.opsError = "검수 사진을 먼저 업로드해주세요.";
    render();
    return;
  }
  if (!state.opsInspectionApproved && (!state.opsDamageType.trim() || state.opsDamageAmount <= 0)) {
    state.opsError = "반려 처리 시 손상 유형과 청구액을 입력해주세요.";
    render();
    return;
  }

  state.opsLoading = true;
  state.opsError = "";
  state.opsNotice = "";
  render();

  try {
    const response = await fetch(`${API_URL}/inspections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: state.opsBooking.id,
        inspectionType: state.opsInspectionType,
        photos: [state.opsInspectionPhotoUrl],
        status: state.opsInspectionApproved ? "approved" : "rejected",
        damageClaim: !state.opsInspectionApproved
          ? { damageType: state.opsDamageType.trim(), amount: state.opsDamageAmount }
          : undefined,
      }),
    });
    if (!response.ok) throw await responseError(response, "검수 등록에 실패했습니다.");

    state.opsNotice = state.opsInspectionApproved
      ? "검수가 승인 처리되었습니다."
      : "검수가 반려되고 손상 클레임이 생성되었습니다.";
    state.opsDamageType = "";
    state.opsDamageAmount = 0;
    state.opsInspectionPhotoUrl = "";
    await refreshOpsBooking();
  } catch (error) {
    state.opsError = `검수 등록 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Ops] Inspection error:", error);
  } finally {
    state.opsLoading = false;
    render();
  }
}

async function resolveOpsClaim(claimId: string, status: "approved" | "rejected"): Promise<void> {
  if (state.opsLoading) return;
  state.opsLoading = true;
  state.opsError = "";
  state.opsNotice = "";
  render();

  try {
    const response = await fetch(`${API_URL}/claims/${claimId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, resolutionNotes: state.opsResolveNotes || undefined }),
    });
    if (!response.ok) throw await responseError(response, "클레임 처리에 실패했습니다.");
    state.opsNotice =
      status === "approved" ? "클레임이 승인되어 보증금에서 차감됩니다." : "클레임이 반려되었습니다.";
    state.opsResolveNotes = "";
    await refreshOpsBooking();
  } catch (error) {
    state.opsError = `클레임 처리 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Ops] Claim resolve error:", error);
  } finally {
    state.opsLoading = false;
    render();
  }
}

async function completeOpsBooking(): Promise<void> {
  if (!state.opsBooking || state.opsLoading) return;
  state.opsLoading = true;
  state.opsError = "";
  state.opsNotice = "";
  render();

  try {
    const response = await fetch(`${API_URL}/bookings/${state.opsBooking.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw await responseError(response, "완료 처리에 실패했습니다.");
    state.opsNotice = "예약이 완료 처리되고 정산이 계산되었습니다.";
    await refreshOpsBooking();
    void fetchOpsKpi().then(render);
  } catch (error) {
    state.opsError = `완료 처리 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Ops] Complete error:", error);
  } finally {
    state.opsLoading = false;
    render();
  }
}

function carrierMedia(carrier: Carrier): string {
  const imageUrl = carrier.thumbnailUrl || carrier.intakePhotoUrl;
  if (imageUrl) {
    return `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(carrier.brandModel)} 사진" />`;
  }
  return `<img src="/luggage-placeholder.svg" alt="" aria-hidden="true" />`;
}

function renderLoadingCards(): string {
  return Array.from({ length: 2 }, () => '<div class="skeleton-card" aria-hidden="true"><span></span><div><i></i><i></i><i></i></div></div>').join("");
}

function renderCarrierCard(carrier: Carrier): string {
  const isSelected = carrier.id === state.selectedCarrierId;
  const referencePrice = Number(carrier.basePrice || carrier.totalPrice);
  const inspectionBadge = carrier.inspectionBadge || "검수 사진 확인";
  const scarcity = Number(carrier.remainingQuantity || 0);

  return `
    <article
      class="carrier-card card ${isSelected ? "is-selected" : ""}"
      data-select="${escapeHtml(carrier.id)}"
      tabindex="0"
      role="button"
      aria-pressed="${isSelected}"
      aria-label="${escapeHtml(carrier.brandModel)} 선택"
    >
      <div class="carrier-media">
        ${carrierMedia(carrier)}
        <span class="media-size">${sizeLabel(carrier.size)}</span>
      </div>
      <div class="carrier-content">
        <div class="card-topline">
          <span class="badge badge--olive">${escapeHtml(inspectionBadge)}</span>
          <span class="card-location">${escapeHtml(carrier.city || "배송 전용")}</span>
        </div>
        <div class="card-heading">
          <div>
            <h3>${escapeHtml(carrier.brandModel)}</h3>
            <p class="card-meta"><strong>★ ${Number(carrier.provider.rating).toFixed(1)}</strong><span>리뷰 ${Number(carrier.provider.reviews).toLocaleString("ko-KR")}</span></p>
          </div>
          <span class="selection-mark" aria-hidden="true">${isSelected ? "✓" : "+"}</span>
        </div>
        <div class="card-signals">
          <span class="scarcity">${scarcity > 0 ? `남은 수량 ${scarcity}개` : "현재 예약 불가"}</span>
          <span>도착 예정 ${escapeHtml(carrier.eta)}</span>
        </div>
        <div class="price-row">
          <div class="reference-price">
            <span class="price-old">${currency(referencePrice)}</span>
            <span class="price-caption">기준가</span>
          </div>
          <div class="total-price">
            <strong>${currency(carrier.totalPrice)}</strong>
            <span>선택 기간 총액</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderCheckout(selected: Carrier | undefined, rentalDays: number): string {
  const detailsAllowed = canContinueToDetails();
  const paymentAllowed = canContinueToPayment();
  const stepClass = (step: Step): string => {
    if (state.step === step) return "is-current";
    if (state.step > step) return "is-complete";
    return "is-upcoming";
  };

  return `
    <aside class="checkout-panel" aria-label="예약 및 결제">
      <div class="checkout-heading">
        <div>
          <p class="eyebrow">CHECKOUT</p>
          <h2>예약을 완성하세요</h2>
        </div>
        <span class="secure-label"><span aria-hidden="true">⌁</span> 안전한 결제</span>
      </div>

      <ol class="checkout-steps" aria-label="결제 단계">
        <li>
          <button type="button" class="checkout-step ${stepClass(1)}" data-step="1">
            <span class="step-number">1</span>
            <span><strong>상품 선택</strong><small>날짜와 사이즈 확인</small></span>
          </button>
        </li>
        <li>
          <button type="button" class="checkout-step ${stepClass(2)}" data-step="2" ${detailsAllowed ? "" : "disabled"}>
            <span class="step-number">2</span>
            <span><strong>정보 입력</strong><small>배송받을 분의 정보</small></span>
          </button>
        </li>
        <li>
          <button type="button" class="checkout-step ${stepClass(3)}" data-step="3" ${paymentAllowed || Boolean(state.bookingId) ? "" : "disabled"}>
            <span class="step-number">3</span>
            <span><strong>결제</strong><small>총액 확인 후 승인</small></span>
          </button>
        </li>
      </ol>

      ${
        selected
          ? `
        <div class="order-summary">
          <div class="summary-product">
            <div class="summary-thumb">${carrierMedia(selected)}</div>
            <div>
              <strong>${escapeHtml(selected.brandModel)}</strong>
              <span>${sizeLabel(selected.size)} · ${rentalDays}일</span>
            </div>
          </div>
          <div class="summary-row"><span>대여료</span><strong>${currency(rentalCharge(selected))}</strong></div>
          <div class="summary-row"><span>왕복 배송비</span><strong>${currency(DISPLAY_POLICY.roundTripShipping)}</strong></div>
          <div class="summary-row summary-total"><span>총결제액</span><strong>${currency(selected.totalPrice)}</strong></div>
          <p class="summary-note">보증금은 결제수단에 사전 승인되며, 반납 검수 후 해제됩니다.</p>
        </div>
      `
          : `
        <div class="checkout-empty">
          <span class="empty-icon" aria-hidden="true">+</span>
          <strong>캐리어를 선택해주세요</strong>
          <p>검색 결과에서 원하는 캐리어를 고르면 가격과 예약 정보를 확인할 수 있어요.</p>
        </div>
      `
      }

      ${
        state.step === 1
          ? `
        <section class="checkout-section">
          <div class="section-kicker">STEP 1</div>
          <h3>선택한 일정이 맞나요?</h3>
          <dl class="detail-list">
            <div><dt>대여 기간</dt><dd>${dateLabel(state.startDate)} - ${dateLabel(state.endDate)}</dd></div>
            <div><dt>수령지</dt><dd>${escapeHtml(selected?.city || state.searchCity || "도시 미지정")}</dd></div>
          </dl>
          <button type="button" id="toStep2" class="button button--primary" ${detailsAllowed ? "" : "disabled"}>정보 입력으로 계속</button>
        </section>
      `
          : ""
      }

      ${
        state.step === 2
          ? `
        <section class="checkout-section">
          <div class="section-kicker">STEP 2</div>
          <h3>배송받을 분의 정보를 입력하세요</h3>
          <div class="field-stack">
            <label class="field">예약자명<input id="customerName" autocomplete="name" value="${escapeHtml(state.customerName)}" placeholder="홍길동" /></label>
            <label class="field">연락처<input id="customerPhone" autocomplete="tel" value="${escapeHtml(state.customerPhone)}" placeholder="010-0000-0000" /></label>
          </div>
          <button type="button" id="toStep3" class="button button--primary" ${paymentAllowed ? "" : "disabled"}>결제 단계로 계속</button>
        </section>
      `
          : ""
      }

      ${
        state.step === 3
          ? `
        <section class="checkout-section">
          <div class="section-kicker">STEP 3</div>
          <h3>${state.paymentAuthorized ? "예약이 확정되었습니다" : "결제수단을 확인하세요"}</h3>
          ${
            state.paymentAuthorized
              ? `
            <div class="success-box success" role="status">
              <span class="success-icon" aria-hidden="true">✓</span>
              <div><strong>결제 승인 완료</strong><p>예약번호 <b>${escapeHtml(state.bookingId)}</b></p></div>
            </div>
            ${
              state.bookingCancelled
                ? `<div class="alert alert--success" role="status"><span>✓</span>예약이 취소되었습니다. 환불 예정액 ${currency(state.cancelRefundAmount ?? 0)}</div>`
                : `<button type="button" id="cancelBookingBtn" class="button button--ghost" ${state.loading ? "disabled" : ""}>${state.loading ? "처리 중..." : "예약 취소하기"}</button>
                   <p class="checkout-disclaimer">취소 시 정책에 따라 결제 48시간 전 100%, 24시간 전 50%, 이후 0% 환불됩니다.</p>`
            }
          `
              : state.bookingId
                ? `
            <div class="success booking-created">
              <div class="success-box"><span class="success-icon" aria-hidden="true">✓</span><div><strong>예약 완료</strong><p>예약번호 <b>${escapeHtml(state.bookingId)}</b></p></div></div>
            </div>
            <div class="payment-method"><span class="payment-card-icon" aria-hidden="true">▣</span><span><strong>테스트 카드</strong><small>**** 4242</small></span><span class="payment-check">✓</span></div>
            <button type="button" id="payAuthorize" class="button button--primary" ${state.loading ? "disabled" : ""}>${state.loading ? "승인 중..." : `${currency(selected?.totalPrice || 0)} 결제 승인`}</button>
          `
                : `
            <div class="payment-method"><span class="payment-card-icon" aria-hidden="true">▣</span><span><strong>테스트 카드로 결제</strong><small>실제 청구 없이 승인 흐름만 확인합니다.</small></span></div>
            <button type="button" id="bookingBtn" class="button button--primary" ${paymentAllowed && !state.loading ? "" : "disabled"}>${state.loading ? "예약 생성 중..." : "예약 생성하고 결제 준비"}</button>
          `
          }
          <p class="checkout-disclaimer">결제 전 취소·환불 정책과 배송 약관을 확인했습니다.</p>
        </section>
      `
          : ""
      }
    </aside>
  `;
}

function renderProvider(): string {
  return `
    <section class="provider-shell">
      <div class="provider-intro">
        <p class="eyebrow">PROVIDER INTAKE</p>
        <h1>사용하지 않는 캐리어를<br /><em>다시 여행하게</em> 하세요.</h1>
        <p>입고 사진과 기준가를 등록하고 렌탈 허용 여부를 선택하면 Luggy가 보관과 배송을 연결합니다.</p>
        <div class="provider-benefits">
          <span><b>01</b> 사진으로 상태 기록</span>
          <span><b>02</b> Opt-in으로 직접 결정</span>
          <span><b>03</b> 완료 후 리워드 정산</span>
        </div>
      </div>
      <section class="provider-card">
        <div class="provider-card-head">
          <div><p class="eyebrow">NEW CARRIER</p><h2>캐리어 등록</h2></div>
          <span class="status-dot"><i></i>입고 준비</span>
        </div>
        <div class="provider-form">
          <label class="field">사이즈
            <select id="providerSize">
              <option value="carry_on" ${state.providerSize === "carry_on" ? "selected" : ""}>기내용</option>
              <option value="medium" ${state.providerSize === "medium" ? "selected" : ""}>중형</option>
            </select>
          </label>
          <label class="field">보관 도시<input id="providerCity" value="${escapeHtml(state.providerCity)}" placeholder="서울" /></label>
          <label class="field">브랜드<input id="providerBrand" value="${escapeHtml(state.providerBrand)}" placeholder="Samsonite" /></label>
          <label class="field">모델명<input id="providerModel" value="${escapeHtml(state.providerModel)}" placeholder="C-Lite" /></label>
          <label class="field">기준가 (원)<input id="providerPrice" type="number" min="1" value="${state.providerBasePrice || ""}" placeholder="120000" /></label>
          <label class="upload-field ${state.providerPhotoUploading ? "is-uploading" : ""}" for="providerPhoto">
            <span class="upload-icon" aria-hidden="true">${state.providerPhotoUploading ? "…" : "↑"}</span>
            <span><strong>${state.providerPhotoUploading ? "업로드 중..." : state.providerPhotoUrl ? "입고 사진 업로드 완료" : "입고 사진 추가"}</strong><small>${state.providerPhotoUrl ? "검수 기록으로 저장됩니다." : "최소 1장의 상태 사진을 권장합니다."}</small></span>
            <input type="file" id="providerPhoto" accept="image/*" ${state.providerPhotoUploading ? "disabled" : ""} />
          </label>
          <label class="check-field"><input type="checkbox" id="providerOptIn" ${state.providerOptIn ? "checked" : ""} /><span><strong>렌탈 허용 Opt-in</strong><small>허용한 캐리어만 Renter 검색에 노출됩니다.</small></span></label>
          <button type="button" id="registerBtn" class="button button--primary" ${state.loading || state.providerPhotoUploading ? "disabled" : ""}>${state.loading ? "등록 중..." : "등록하고 렌탈 허용하기"}</button>
        </div>
      </section>
      <section class="provider-inventory">
        <div class="section-head">
          <div><p class="eyebrow">MY INVENTORY</p><h2>내 캐리어</h2></div>
          <span class="count-label">${state.providerCarriers.length}개</span>
        </div>
        ${
          state.providerCarriers.length === 0
            ? '<div class="empty-state"><span class="empty-icon" aria-hidden="true">+</span><strong>아직 등록된 캐리어가 없습니다.</strong><p>첫 캐리어의 상태 사진과 기준가를 등록해보세요.</p></div>'
            : `<div class="inventory-list">${state.providerCarriers
                .map(
                  (carrier) => `
                  <article class="inventory-item">
                    <div class="inventory-thumb">${carrierMedia(carrier)}</div>
                    <div class="inventory-copy"><strong>${escapeHtml(carrier.brandModel)}</strong><span>${sizeLabel(carrier.size)} · ${escapeHtml(carrier.city || "서울")} · 기준가 ${currency(carrier.basePrice || 0)}</span></div>
                    <span class="inventory-status ${carrier.optInRentable ? "is-live" : ""}"><i></i>${carrier.optInRentable ? "렌탈 허용" : "입고 확인 중"}</span>
                    ${
                      carrier.optInRentable
                        ? ""
                        : `<button type="button" class="button button--ghost button--small" data-optin-retry="${escapeHtml(carrier.id)}" ${state.loading ? "disabled" : ""}>렌탈 허용으로 전환</button>`
                    }
                  </article>
                `,
                )
                .join("")}</div>`
        }
      </section>
    </section>
  `;
}

function renderOps(): string {
  const kpi = state.opsKpi;
  const booking = state.opsBooking;

  const kpiSection = `
    <section class="ops-panel ops-kpi">
      <div class="section-head">
        <div><p class="eyebrow">KPI DASHBOARD</p><h2>운영 지표</h2></div>
        <button type="button" id="opsRefreshKpi" class="button button--ghost button--small">새로고침</button>
      </div>
      ${
        kpi
          ? `
        <div class="ops-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">랜딩 → 결제 전환</span>
            <strong>${(kpi.funnel.conversion.landingToPaid * 100).toFixed(1)}%</strong>
            <small>랜딩 ${kpi.funnel.landing} · 결제 ${kpi.funnel.paid}</small>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">검색 → 상세 전환</span>
            <strong>${(kpi.funnel.conversion.searchToDetail * 100).toFixed(1)}%</strong>
            <small>검색 ${kpi.funnel.search} · 상세 ${kpi.funnel.detail}</small>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">상세 → 결제 시작</span>
            <strong>${(kpi.funnel.conversion.detailToCheckout * 100).toFixed(1)}%</strong>
            <small>결제 시작 ${kpi.funnel.checkout}</small>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Provider Opt-in 비율</span>
            <strong>${(kpi.providerOptInRate * 100).toFixed(1)}%</strong>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">예약 완료율</span>
            <strong>${(kpi.bookingCompletionRate * 100).toFixed(1)}%</strong>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">분쟁(클레임) 비율</span>
            <strong>${(kpi.disputeRate * 100).toFixed(1)}%</strong>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">건당 평균 공헌이익</span>
            <strong>${kpi.avgContributionProfitPerBooking !== null ? currency(kpi.avgContributionProfitPerBooking) : "-"}</strong>
          </div>
        </div>
        <div class="ops-status-breakdown">
          ${Object.entries(kpi.bookingsByStatus)
            .map(
              ([status, count]) =>
                `<span class="status-chip">${BOOKING_STATUS_LABEL[status] || status} <b>${count}</b></span>`,
            )
            .join("")}
        </div>
        <p class="ops-generated-at">기준 시각: ${new Date(kpi.generatedAt).toLocaleString("ko-KR")}</p>
      `
          : `<p class="ops-empty-note">KPI 데이터를 불러오는 중...</p>`
      }
    </section>
  `;

  const lookupSection = `
    <section class="ops-panel">
      <div class="section-head">
        <div><p class="eyebrow">BOOKING LOOKUP</p><h2>예약 운영</h2></div>
      </div>
      <div class="ops-lookup">
        <input id="opsBookingIdInput" value="${escapeHtml(state.opsBookingIdInput)}" placeholder="예약 ID 입력 (UUID)" />
        <button type="button" id="opsLookupBtn" class="button button--primary" ${state.opsLoading ? "disabled" : ""}>조회</button>
      </div>
      ${state.opsError ? `<div class="alert alert--error" role="alert"><span>!</span>${escapeHtml(state.opsError)}</div>` : ""}
      ${state.opsNotice ? `<div class="alert alert--success" role="status"><span>✓</span>${escapeHtml(state.opsNotice)}</div>` : ""}
    </section>
  `;

  if (!booking) {
    return `<section class="ops-shell">${kpiSection}${lookupSection}</section>`;
  }

  const canCancel = !["completed", "cancelled"].includes(booking.status);
  const canComplete = !["completed", "cancelled"].includes(booking.status);

  const detailSection = `
    <section class="ops-panel ops-booking-detail">
      <div class="section-head">
        <div><p class="eyebrow">BOOKING #${escapeHtml(booking.id.slice(0, 8))}</p><h2>${BOOKING_STATUS_LABEL[booking.status] || booking.status}</h2></div>
        <span class="status-dot"><i></i>배송 ${DELIVERY_STATUS_LABEL[booking.deliveryStatus] || booking.deliveryStatus}</span>
      </div>
      <dl class="detail-list">
        <div><dt>대여 기간</dt><dd>${dateLabel(String(booking.startDate).slice(0, 10))} - ${dateLabel(String(booking.endDate).slice(0, 10))}</dd></div>
        <div><dt>총 결제액</dt><dd>${currency(booking.totalPrice)}</dd></div>
        ${
          booking.payment
            ? `<div><dt>결제 상태</dt><dd>${escapeHtml(booking.payment.status)}${booking.payment.depositAmount ? ` · 보증금 ${currency(booking.payment.depositAmount)}` : ""}</dd></div>`
            : ""
        }
      </dl>

      <div class="ops-actions">
        <button type="button" id="opsCancelBtn" class="button button--ghost" ${!canCancel || state.opsLoading ? "disabled" : ""}>예약 취소</button>
        <button type="button" id="opsCompleteBtn" class="button button--primary" ${!canComplete || state.opsLoading ? "disabled" : ""}>완료 처리</button>
      </div>

      <div class="ops-grid">
        <div class="ops-block">
          <h3>원장 (Ledger)</h3>
          ${
            booking.ledgerEntries.length
              ? `<table class="ledger-table"><tbody>${booking.ledgerEntries
                  .map(
                    (entry) => `
                <tr><td>${LEDGER_ENTRY_LABEL[entry.entryType] || entry.entryType}</td><td>${currency(entry.amount)}</td><td>${new Date(entry.createdAt).toLocaleString("ko-KR")}</td></tr>
              `,
                  )
                  .join("")}</tbody></table>`
              : `<p class="ops-empty-note">아직 원장 항목이 없습니다.</p>`
          }
        </div>

        <div class="ops-block">
          <h3>배송</h3>
          <ul class="timeline-list">
            ${
              booking.deliveryTimeline.length
                ? booking.deliveryTimeline
                    .map(
                      (event) => `
                  <li><b>${event.direction === "outbound" ? "출고" : "반납"}</b> ${DELIVERY_STATUS_LABEL[event.status] || event.status} · ${new Date(event.createdAt).toLocaleString("ko-KR")}</li>
                `,
                    )
                    .join("")
                : `<li class="ops-empty-note">배송 이벤트가 없습니다.</li>`
            }
          </ul>
          <div class="ops-form-row">
            <select id="opsDeliveryDirection">
              <option value="outbound" ${state.opsDeliveryDirection === "outbound" ? "selected" : ""}>출고</option>
              <option value="return" ${state.opsDeliveryDirection === "return" ? "selected" : ""}>반납</option>
            </select>
            <select id="opsDeliveryStatus">
              <option value="in_transit" ${state.opsDeliveryStatus === "in_transit" ? "selected" : ""}>배송 중</option>
              <option value="arrived" ${state.opsDeliveryStatus === "arrived" ? "selected" : ""}>도착</option>
              <option value="delayed" ${state.opsDeliveryStatus === "delayed" ? "selected" : ""}>지연</option>
            </select>
            <button type="button" id="opsSimulateDeliveryBtn" class="button button--primary button--small" ${state.opsLoading ? "disabled" : ""}>배송 이벤트 발생</button>
          </div>
        </div>

        <div class="ops-block">
          <h3>검수</h3>
          <ul class="timeline-list">
            ${
              booking.inspections.length
                ? booking.inspections
                    .map(
                      (inspection) => `
                  <li><b>${inspection.inspectionType}</b> ${inspection.status} · ${new Date(inspection.createdAt).toLocaleString("ko-KR")}</li>
                `,
                    )
                    .join("")
                : `<li class="ops-empty-note">검수 기록이 없습니다.</li>`
            }
          </ul>
          <div class="ops-inspection-form">
            <select id="opsInspectionType">
              <option value="intake" ${state.opsInspectionType === "intake" ? "selected" : ""}>입고</option>
              <option value="outbound" ${state.opsInspectionType === "outbound" ? "selected" : ""}>출고</option>
              <option value="return" ${state.opsInspectionType === "return" ? "selected" : ""}>반납</option>
            </select>
            <div class="ops-radio-row">
              <label><input type="radio" name="opsInspectionResult" id="opsInspectionApprove" value="approved" ${state.opsInspectionApproved ? "checked" : ""} /> 승인</label>
              <label><input type="radio" name="opsInspectionResult" id="opsInspectionReject" value="rejected" ${!state.opsInspectionApproved ? "checked" : ""} /> 반려(손상)</label>
            </div>
            ${
              !state.opsInspectionApproved
                ? `
              <div class="ops-form-row">
                <input id="opsDamageType" value="${escapeHtml(state.opsDamageType)}" placeholder="손상 유형 (예: 바퀴 파손)" />
                <input id="opsDamageAmount" type="number" min="1" value="${state.opsDamageAmount || ""}" placeholder="청구액 (원)" />
              </div>
            `
                : ""
            }
            <label class="upload-field ${state.opsInspectionUploading ? "is-uploading" : ""}" for="opsInspectionPhoto">
              <span class="upload-icon" aria-hidden="true">${state.opsInspectionUploading ? "…" : "↑"}</span>
              <span><strong>${state.opsInspectionUploading ? "업로드 중..." : state.opsInspectionPhotoUrl ? "검수 사진 업로드 완료" : "검수 사진 업로드"}</strong><small>Azure Blob(또는 로컬 저장소)에 실제 업로드됩니다.</small></span>
              <input type="file" id="opsInspectionPhoto" accept="image/*" ${state.opsInspectionUploading ? "disabled" : ""} />
            </label>
            <button type="button" id="opsSubmitInspectionBtn" class="button button--primary button--small" ${state.opsLoading || state.opsInspectionUploading ? "disabled" : ""}>검수 제출</button>
          </div>
        </div>

        <div class="ops-block">
          <h3>클레임</h3>
          ${
            booking.claims.length
              ? `
            <ul class="timeline-list claim-list">${booking.claims
              .map(
                (claim) => `
              <li class="claim-item">
                <div><b>${escapeHtml(claim.damageType)}</b> ${currency(claim.amount)} · ${CLAIM_STATUS_LABEL[claim.status] || claim.status}</div>
                ${
                  claim.status === "pending"
                    ? `
                  <div class="ops-form-row">
                    <button type="button" class="button button--primary button--small" data-resolve-claim="${escapeHtml(claim.id)}" data-resolve-status="approved" ${state.opsLoading ? "disabled" : ""}>승인</button>
                    <button type="button" class="button button--ghost button--small" data-resolve-claim="${escapeHtml(claim.id)}" data-resolve-status="rejected" ${state.opsLoading ? "disabled" : ""}>반려</button>
                  </div>
                `
                    : ""
                }
              </li>
            `,
              )
              .join("")}</ul>
            ${
              booking.claims.some((claim) => claim.status === "pending")
                ? `<input id="opsResolveNotes" value="${escapeHtml(state.opsResolveNotes)}" placeholder="처리 메모 (선택)" />`
                : ""
            }
          `
              : `<p class="ops-empty-note">클레임이 없습니다.</p>`
          }
        </div>

        ${
          booking.settlement
            ? `
          <div class="ops-block">
            <h3>정산</h3>
            <dl class="detail-list">
              <div><dt>총액</dt><dd>${currency(booking.settlement.grossAmount)}</dd></div>
              <div><dt>Platform (80%)</dt><dd>${currency(booking.settlement.platformFee)}</dd></div>
              <div><dt>Provider (20%)</dt><dd>${currency(booking.settlement.providerPayout)}</dd></div>
            </dl>
          </div>
        `
            : ""
        }
      </div>
    </section>
  `;

  return `<section class="ops-shell">${kpiSection}${lookupSection}${detailSection}</section>`;
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("missing app root");

  const rentalDays = daysBetween(state.startDate, state.endDate);
  const selected = selectedCarrier();

  app.innerHTML = `
    <main class="page">
      <header class="topbar">
        <a class="brand" href="/" aria-label="Luggy 홈">luggy<span>.</span></a>
        <div class="topbar-right">
          <span class="topbar-note">여행을 가볍게, 필요한 만큼</span>
          <nav class="menu" aria-label="주요 메뉴">
            <button type="button" data-tab="rent" class="nav-btn ${state.tab === "rent" ? "is-active" : ""}">렌탈</button>
            <button type="button" data-tab="provider" class="nav-btn ${state.tab === "provider" ? "is-active" : ""}">맡기기</button>
            <button type="button" data-tab="p2p" class="nav-btn ${state.tab === "p2p" ? "is-active" : ""}">동네 직거래</button>
            <button type="button" data-tab="ops" class="nav-btn ${state.tab === "ops" ? "is-active" : ""}">운영</button>
          </nav>
        </div>
      </header>

      ${state.error ? `<div class="alert alert--error" role="alert"><span>!</span>${escapeHtml(state.error)}</div>` : ""}
      ${state.notice ? `<div class="alert alert--success" role="status"><span>✓</span>${escapeHtml(state.notice)}</div>` : ""}

      ${
        state.tab === "rent"
          ? `
        <section class="hero">
          <div class="hero-copy">
            <p class="eyebrow">CARRY LESS, GO FURTHER</p>
            <h1>여행에 필요한 만큼,<br /><em>가볍게 빌리세요.</em></h1>
            <p>검수된 캐리어를 원하는 날짜에 배송받고, 여행이 끝나면 편하게 반납하세요.</p>
            <div class="hero-proof"><span><i>✓</i> 검수 사진 공개</span><span><i>✓</i> 왕복 배송</span><span><i>✓</i> 투명한 총액</span></div>
          </div>
          <form class="search-panel" id="searchForm">
            <div class="search-panel-head"><div><span class="search-label">여행 일정 검색</span><strong>어디로 떠나시나요?</strong></div><span class="search-hint">최소 2일 대여</span></div>
            <div class="search-grid">
              <label class="field"><span>대여 시작일</span><input id="startDate" type="date" value="${escapeHtml(state.startDate)}" aria-describedby="dateHint" /></label>
              <label class="field"><span>반납일</span><input id="endDate" type="date" min="${escapeHtml(state.startDate)}" value="${escapeHtml(state.endDate)}" aria-describedby="dateHint" /></label>
              <label class="field"><span>사이즈</span><select id="size"><option value="carry_on" ${state.size === "carry_on" ? "selected" : ""}>기내용</option><option value="medium" ${state.size === "medium" ? "selected" : ""}>중형</option></select></label>
              <label class="field"><span>도시 <small>(선택)</small></span><select id="searchCity"><option value="">전체 도시</option>${state.availableCities.map((city) => `<option value="${escapeHtml(city)}" ${state.searchCity === city ? "selected" : ""}>${escapeHtml(city)}</option>`).join("")}</select></label>
              <button type="submit" id="searchBtn" class="button button--primary search-button" ${canSearch() && !state.loading ? "" : "disabled"}>${state.loading ? "검색 중..." : "즉시 조회"}<span aria-hidden="true">↗</span></button>
            </div>
            <p id="dateHint" class="${rentalDays < DISPLAY_POLICY.minRentalDays ? "field-hint is-warning" : "field-hint"}">${rentalDays < DISPLAY_POLICY.minRentalDays ? "최소 대여기간은 2일입니다." : `${rentalDays}일 일정 · 날짜를 선택하면 총액이 바로 계산됩니다.`}</p>
          </form>
        </section>
        <section class="funnel-layout">
          <section class="results-panel" aria-labelledby="results-title">
            <div class="section-head">
              <div><p class="eyebrow">AVAILABLE NOW</p><h2 id="results-title">렌탈 가능한 캐리어</h2></div>
              <div class="result-tools"><span class="count-label">${state.searchResults.length ? `${state.searchResults.length}개` : "검색 전"}</span><label class="sort-control">정렬<select id="sort"><option value="recommended" ${state.sort === "recommended" ? "selected" : ""}>추천순</option><option value="newest" ${state.sort === "newest" ? "selected" : ""}>최신순</option></select></label></div>
            </div>
            ${
              state.loading
                ? `<div class="cards">${renderLoadingCards()}</div>`
                : state.searchResults.length
                  ? `<div class="cards">${state.searchResults.map(renderCarrierCard).join("")}</div>`
                  : `<div class="empty-state results-empty"><span class="empty-icon" aria-hidden="true">⌕</span><strong>원하는 일정을 검색해보세요.</strong><p>날짜와 사이즈를 선택하면 지금 예약 가능한 캐리어를 보여드릴게요.</p></div>`
            }
          </section>
          ${renderCheckout(selected, rentalDays)}
        </section>
      `
          : state.tab === "provider"
            ? renderProvider()
            : state.tab === "p2p"
              ? renderP2pTab()
              : renderOps()
      }
      <footer class="page-footer"><span>luggy</span><span>검수부터 반납까지, 가벼운 여행의 기본</span></footer>
    </main>
  `;

  bindEvents();
}

function updatePaymentButton(): void {
  const button = document.querySelector<HTMLButtonElement>("#toStep3");
  if (button) button.disabled = !canContinueToPayment();
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const previousTab = state.tab;
      state.tab = button.dataset.tab as Tab;
      state.step = 1;
      state.error = "";
      state.notice = "";
      if (previousTab === "p2p" && state.tab !== "p2p") stopP2pTab();
      if (state.tab === "provider") void fetchProviderCarriers().then(render);
      if (state.tab === "rent") void fetchAvailableCities().then(render);
      if (state.tab === "p2p") initP2pTab(render);
      if (state.tab === "ops") {
        if (!state.opsBookingIdInput && state.bookingId) state.opsBookingIdInput = state.bookingId;
        void fetchOpsKpi().then(render);
        if (state.opsBookingIdInput && !state.opsBooking) void fetchOpsBooking();
      }
      render();
    });
  });

  bindP2pEvents(render);

  document.querySelector<HTMLFormElement>("#searchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void searchCarriers();
  });
  document.querySelector<HTMLInputElement>("#startDate")?.addEventListener("change", (event) => {
    state.startDate = (event.target as HTMLInputElement).value;
    render();
    void fetchAvailableCities().then(render);
  });
  document.querySelector<HTMLInputElement>("#endDate")?.addEventListener("change", (event) => {
    state.endDate = (event.target as HTMLInputElement).value;
    render();
    void fetchAvailableCities().then(render);
  });
  document.querySelector<HTMLSelectElement>("#searchCity")?.addEventListener("change", (event) => {
    state.searchCity = (event.target as HTMLSelectElement).value;
  });
  document.querySelector<HTMLSelectElement>("#size")?.addEventListener("change", (event) => {
    state.size = (event.target as HTMLSelectElement).value as Size;
    state.selectedCarrierId = "";
    state.step = 1;
    render();
    void fetchAvailableCities().then(render);
  });
  document.querySelector<HTMLSelectElement>("#sort")?.addEventListener("change", (event) => {
    state.sort = (event.target as HTMLSelectElement).value;
    if (state.searchResults.length) void searchCarriers();
  });

  document.querySelectorAll<HTMLElement>("[data-select]").forEach((card) => {
    const selectCard = () => {
      state.selectedCarrierId = card.dataset.select || "";
      state.step = 1;
      state.bookingId = "";
      state.paymentAuthorized = false;
      state.bookingCancelled = false;
      state.cancelRefundAmount = null;
      state.error = "";
      void logFunnelEvent("detail_view", { carrierId: state.selectedCarrierId });
      render();
    };
    card.addEventListener("click", selectCard);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCard();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const step = Number(button.dataset.step) as Step;
      if (step === 1 || (step === 2 && canContinueToDetails()) || (step === 3 && canContinueToPayment()) || (step === 3 && Boolean(state.bookingId))) {
        state.step = step;
        render();
      }
    });
  });
  document.querySelector<HTMLButtonElement>("#toStep2")?.addEventListener("click", () => {
    state.step = 2;
    void logFunnelEvent("checkout_step1", { step: 1, carrierId: state.selectedCarrierId });
    render();
  });
  document.querySelector<HTMLInputElement>("#customerName")?.addEventListener("input", (event) => {
    state.customerName = (event.target as HTMLInputElement).value;
    updatePaymentButton();
  });
  document.querySelector<HTMLInputElement>("#customerPhone")?.addEventListener("input", (event) => {
    state.customerPhone = (event.target as HTMLInputElement).value;
    updatePaymentButton();
  });
  document.querySelector<HTMLButtonElement>("#toStep3")?.addEventListener("click", () => {
    if (!canContinueToPayment()) return;
    state.step = 3;
    void logFunnelEvent("checkout_step2", { step: 2, carrierId: state.selectedCarrierId });
    void createBooking();
    render();
  });
  document.querySelector<HTMLButtonElement>("#bookingBtn")?.addEventListener("click", () => {
    void createBooking();
  });
  document.querySelector<HTMLButtonElement>("#payAuthorize")?.addEventListener("click", () => {
    void authorizePayment();
  });
  document.querySelector<HTMLButtonElement>("#cancelBookingBtn")?.addEventListener("click", () => {
    void cancelCurrentBooking();
  });

  document.querySelector<HTMLSelectElement>("#providerSize")?.addEventListener("change", (event) => {
    state.providerSize = (event.target as HTMLSelectElement).value as Size;
  });
  document.querySelector<HTMLInputElement>("#providerCity")?.addEventListener("input", (event) => {
    state.providerCity = (event.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#providerBrand")?.addEventListener("input", (event) => {
    state.providerBrand = (event.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#providerModel")?.addEventListener("input", (event) => {
    state.providerModel = (event.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#providerPrice")?.addEventListener("input", (event) => {
    state.providerBasePrice = Number((event.target as HTMLInputElement).value) || 0;
  });
  document.querySelector<HTMLInputElement>("#providerPhoto")?.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    state.providerPhotoUploading = true;
    state.error = "";
    render();
    uploadPhoto(file, "intake")
      .then((blobUrl) => {
        state.providerPhotoUrl = blobUrl;
      })
      .catch((error) => {
        state.error = `사진 업로드 실패: ${error instanceof Error ? error.message : String(error)}`;
        console.error("[Upload] Error:", error);
      })
      .finally(() => {
        state.providerPhotoUploading = false;
        render();
      });
  });
  document.querySelector<HTMLInputElement>("#providerOptIn")?.addEventListener("change", (event) => {
    state.providerOptIn = (event.target as HTMLInputElement).checked;
  });
  document.querySelector<HTMLButtonElement>("#registerBtn")?.addEventListener("click", () => {
    void registerCarrier();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-optin-retry]").forEach((button) => {
    button.addEventListener("click", () => {
      const carrierId = button.dataset.optinRetry;
      if (carrierId) void retryOptIn(carrierId);
    });
  });

  // ---- Ops console bindings ----
  document.querySelector<HTMLInputElement>("#opsBookingIdInput")?.addEventListener("input", (event) => {
    state.opsBookingIdInput = (event.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#opsBookingIdInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void fetchOpsBooking();
    }
  });
  document.querySelector<HTMLButtonElement>("#opsLookupBtn")?.addEventListener("click", () => {
    void fetchOpsBooking();
  });
  document.querySelector<HTMLButtonElement>("#opsRefreshKpi")?.addEventListener("click", () => {
    void fetchOpsKpi().then(render);
  });
  document.querySelector<HTMLButtonElement>("#opsCancelBtn")?.addEventListener("click", () => {
    void cancelOpsBooking();
  });
  document.querySelector<HTMLButtonElement>("#opsCompleteBtn")?.addEventListener("click", () => {
    void completeOpsBooking();
  });
  document.querySelector<HTMLSelectElement>("#opsDeliveryDirection")?.addEventListener("change", (event) => {
    state.opsDeliveryDirection = (event.target as HTMLSelectElement).value as DeliveryDirection;
  });
  document.querySelector<HTMLSelectElement>("#opsDeliveryStatus")?.addEventListener("change", (event) => {
    state.opsDeliveryStatus = (event.target as HTMLSelectElement).value as DeliveryStatus;
  });
  document.querySelector<HTMLButtonElement>("#opsSimulateDeliveryBtn")?.addEventListener("click", () => {
    void simulateOpsDelivery();
  });
  document.querySelector<HTMLSelectElement>("#opsInspectionType")?.addEventListener("change", (event) => {
    state.opsInspectionType = (event.target as HTMLSelectElement).value as InspectionType;
  });
  document.querySelector<HTMLInputElement>("#opsInspectionApprove")?.addEventListener("change", () => {
    state.opsInspectionApproved = true;
    render();
  });
  document.querySelector<HTMLInputElement>("#opsInspectionReject")?.addEventListener("change", () => {
    state.opsInspectionApproved = false;
    render();
  });
  document.querySelector<HTMLInputElement>("#opsDamageType")?.addEventListener("input", (event) => {
    state.opsDamageType = (event.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#opsDamageAmount")?.addEventListener("input", (event) => {
    state.opsDamageAmount = Number((event.target as HTMLInputElement).value) || 0;
  });
  document.querySelector<HTMLInputElement>("#opsInspectionPhoto")?.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    state.opsInspectionUploading = true;
    state.opsError = "";
    render();
    uploadPhoto(file, "inspection")
      .then((blobUrl) => {
        state.opsInspectionPhotoUrl = blobUrl;
      })
      .catch((error) => {
        state.opsError = `사진 업로드 실패: ${error instanceof Error ? error.message : String(error)}`;
        console.error("[Upload] Error:", error);
      })
      .finally(() => {
        state.opsInspectionUploading = false;
        render();
      });
  });
  document.querySelector<HTMLButtonElement>("#opsSubmitInspectionBtn")?.addEventListener("click", () => {
    void submitOpsInspection();
  });
  document.querySelector<HTMLInputElement>("#opsResolveNotes")?.addEventListener("input", (event) => {
    state.opsResolveNotes = (event.target as HTMLInputElement).value;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-resolve-claim]").forEach((button) => {
    button.addEventListener("click", () => {
      const claimId = button.dataset.resolveClaim;
      const status = button.dataset.resolveStatus as "approved" | "rejected";
      if (claimId && status) void resolveOpsClaim(claimId, status);
    });
  });
}

void logFunnelEvent("landing_view", { timestamp: new Date().toISOString() });
render();
void fetchAvailableCities().then(render);
