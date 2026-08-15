import "./styles.css";
import { shouldDisableBookingCTA } from "./funnel.js";

type Size = "carry_on" | "medium";
type Tab = "rent" | "provider";
type Step = 1 | 2 | 3;

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
  deliveryAddress: "",
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
  providerSize: "carry_on" as Size,
  providerBrand: "",
  providerModel: "",
  providerBasePrice: 0,
  providerPhotoUrl: "",
  providerOptIn: true,
  providerCarriers: [] as Carrier[],
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
  render();

  try {
    const url = new URL(`${API_URL}/renters/search`);
    url.searchParams.set("size", state.size);
    url.searchParams.set("start_date", state.startDate);
    url.searchParams.set("end_date", state.endDate);
    url.searchParams.set("sort", state.sort);
    if (state.deliveryAddress.trim()) {
      url.searchParams.set("delivery_address", state.deliveryAddress.trim());
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

async function createBooking(): Promise<void> {
  if (!canContinueToPayment() || state.loading) return;

  const carrier = selectedCarrier();
  if (!carrier) return;

  state.loading = true;
  state.error = "";
  state.notice = "";
  state.bookingId = "";
  state.paymentAuthorized = false;
  render();

  try {
    const request: BookingRequest = {
      renterId: MOCK_RENTER_ID,
      carrierId: carrier.id,
      startDate: state.startDate,
      endDate: state.endDate,
      idempotencyKey: `booking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
    const response = await fetch(`${API_URL}/providers/carriers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: MOCK_PROVIDER_ID,
        size: state.providerSize,
        brandModel: `${state.providerBrand.trim()} ${state.providerModel.trim()}`,
        basePrice: state.providerBasePrice,
        intakePhotoUrl: state.providerPhotoUrl || undefined,
      }),
    });
    if (!response.ok) throw await responseError(response, "캐리어 등록에 실패했습니다.");

    const carrier = await response.json();
    if (state.providerOptIn) {
      const optInResponse = await fetch(`${API_URL}/providers/carriers/${carrier.id}/opt-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!optInResponse.ok) throw await responseError(optInResponse, "Opt-in 처리에 실패했습니다.");
    }

    state.providerBrand = "";
    state.providerModel = "";
    state.providerBasePrice = 0;
    state.providerPhotoUrl = "";
    state.notice = state.providerOptIn
      ? "캐리어가 등록되고 렌탈 허용 상태로 전환되었습니다."
      : "캐리어가 입고 신청되었습니다.";
    await fetchProviderCarriers();
  } catch (error) {
    state.error = `등록 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[Provider] Error:", error);
  } finally {
    state.loading = false;
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
          <span class="card-location">배송 전용</span>
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
            <div><dt>수령지</dt><dd>${escapeHtml(state.deliveryAddress || "배송지 입력 예정")}</dd></div>
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
          <label class="field">브랜드<input id="providerBrand" value="${escapeHtml(state.providerBrand)}" placeholder="Samsonite" /></label>
          <label class="field">모델명<input id="providerModel" value="${escapeHtml(state.providerModel)}" placeholder="C-Lite" /></label>
          <label class="field">기준가 (원)<input id="providerPrice" type="number" min="1" value="${state.providerBasePrice || ""}" placeholder="120000" /></label>
          <label class="upload-field" for="providerPhoto">
            <span class="upload-icon" aria-hidden="true">↑</span>
            <span><strong>${state.providerPhotoUrl ? "입고 사진 선택됨" : "입고 사진 추가"}</strong><small>${state.providerPhotoUrl ? "검수 기록으로 저장됩니다." : "최소 1장의 상태 사진을 권장합니다."}</small></span>
            <input type="file" id="providerPhoto" accept="image/*" />
          </label>
          <label class="check-field"><input type="checkbox" id="providerOptIn" ${state.providerOptIn ? "checked" : ""} /><span><strong>렌탈 허용 Opt-in</strong><small>허용한 캐리어만 Renter 검색에 노출됩니다.</small></span></label>
          <button type="button" id="registerBtn" class="button button--primary" ${state.loading ? "disabled" : ""}>${state.loading ? "등록 중..." : "등록하고 렌탈 허용하기"}</button>
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
                    <div class="inventory-copy"><strong>${escapeHtml(carrier.brandModel)}</strong><span>${sizeLabel(carrier.size)} · 기준가 ${currency(carrier.basePrice || 0)}</span></div>
                    <span class="inventory-status ${carrier.optInRentable ? "is-live" : ""}"><i></i>${carrier.optInRentable ? "렌탈 허용" : "입고 확인 중"}</span>
                  </article>
                `,
                )
                .join("")}</div>`
        }
      </section>
    </section>
  `;
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
          </nav>
        </div>
      </header>

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
              <label class="field field--address"><span>수령 지역 <small>(선택)</small></span><input id="deliveryAddress" value="${escapeHtml(state.deliveryAddress)}" placeholder="예: 서울 강남구" autocomplete="street-address" /></label>
              <button type="submit" id="searchBtn" class="button button--primary search-button" ${canSearch() && !state.loading ? "" : "disabled"}>${state.loading ? "검색 중..." : "즉시 조회"}<span aria-hidden="true">↗</span></button>
            </div>
            <p id="dateHint" class="${rentalDays < DISPLAY_POLICY.minRentalDays ? "field-hint is-warning" : "field-hint"}">${rentalDays < DISPLAY_POLICY.minRentalDays ? "최소 대여기간은 2일입니다." : `${rentalDays}일 일정 · 날짜를 선택하면 총액이 바로 계산됩니다.`}</p>
          </form>
        </section>
        ${state.error ? `<div class="alert alert--error" role="alert"><span>!</span>${escapeHtml(state.error)}</div>` : ""}
        ${state.notice ? `<div class="alert alert--success" role="status"><span>✓</span>${escapeHtml(state.notice)}</div>` : ""}
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
          : renderProvider()
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
      state.tab = button.dataset.tab as Tab;
      state.step = 1;
      state.error = "";
      state.notice = "";
      if (state.tab === "provider") void fetchProviderCarriers().then(render);
      render();
    });
  });

  document.querySelector<HTMLFormElement>("#searchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void searchCarriers();
  });
  document.querySelector<HTMLInputElement>("#startDate")?.addEventListener("change", (event) => {
    state.startDate = (event.target as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLInputElement>("#endDate")?.addEventListener("change", (event) => {
    state.endDate = (event.target as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLInputElement>("#deliveryAddress")?.addEventListener("input", (event) => {
    state.deliveryAddress = (event.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLSelectElement>("#size")?.addEventListener("change", (event) => {
    state.size = (event.target as HTMLSelectElement).value as Size;
    state.selectedCarrierId = "";
    state.step = 1;
    render();
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

  document.querySelector<HTMLSelectElement>("#providerSize")?.addEventListener("change", (event) => {
    state.providerSize = (event.target as HTMLSelectElement).value as Size;
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
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      state.providerPhotoUrl = String(reader.result || "");
      render();
    });
    reader.readAsDataURL(file);
  });
  document.querySelector<HTMLInputElement>("#providerOptIn")?.addEventListener("change", (event) => {
    state.providerOptIn = (event.target as HTMLInputElement).checked;
  });
  document.querySelector<HTMLButtonElement>("#registerBtn")?.addEventListener("click", () => {
    void registerCarrier();
  });
}

void logFunnelEvent("landing_view", { timestamp: new Date().toISOString() });
render();
