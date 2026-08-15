import "./styles.css";

type Size = "carry_on" | "medium";
type Tab = "rent" | "provider";
type Step = 1 | 2 | 3;

type Carrier = {
  id: string;
  size: Size;
  brandModel: string;
  totalPrice: number;
  eta: string;
  remainingQuantity: number;
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
const MOCK_RENTER_ID = "550e8400-e29b-41d4-a716-446655440000"; // Mock UUID
const MOCK_PROVIDER_ID = "550e8400-e29b-41d4-a716-446655440001"; // Mock UUID

// Session ID for analytics
const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Funnel event tracker
async function logFunnelEvent(eventType: string, metadata?: Record<string, any>) {
  try {
    await fetch(`${API_URL}/funnel/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        sessionId,
        metadata: metadata || {},
      }),
    });
  } catch (err) {
    console.error("[Analytics] Failed to log event:", eventType, err);
  }
}

const state = {
  tab: "rent" as Tab,
  step: 1 as Step,
  startDate: futureDate(7),
  endDate: futureDate(9),
  size: "carry_on" as Size,
  searchResults: [] as Carrier[],
  selectedCarrierId: "" as string,
  customerName: "",
  customerPhone: "",
  loading: false,
  error: "",
  bookingId: "",
  // Provider state
  providerSize: "carry_on" as Size,
  providerBrand: "",
  providerModel: "",
  providerBasePrice: 0,
  providerPhotoUrl: "",
  providerOptIn: true,
  providerCarriers: [] as any[],
};

function futureDate(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function currency(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function totalPrice(size: Size, days: number): number {
  const rates = { carry_on: 7900, medium: 11900 };
  return rates[size] * days + 14000;
}

async function searchCarriers() {
  state.loading = true;
  state.error = "";
  state.searchResults = [];

  try {
    const url = new URL(`${API_URL}/renters/search`);
    url.searchParams.append("size", state.size);
    url.searchParams.append("start_date", state.startDate);
    url.searchParams.append("end_date", state.endDate);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Search failed");

    const data = await res.json();
    state.searchResults = data.items || [];

    // Log search + result view
    const rentalDays = daysBetween(state.startDate, state.endDate);
    logFunnelEvent("search_submit", {
      size: state.size,
      days: rentalDays,
      resultCount: state.searchResults.length,
    });
    logFunnelEvent("result_view", {
      size: state.size,
      itemCount: state.searchResults.length,
    });
  } catch (err) {
    state.error = `검색 실패: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[Search] Error:", err);
  } finally {
    state.loading = false;
  }
}

async function createBooking() {
  if (!state.selectedCarrierId || state.loading) return;

  state.loading = true;
  state.error = "";
  state.bookingId = "";

  try {
    const rentalDays = daysBetween(state.startDate, state.endDate);
    const idempotencyKey = `booking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const req: BookingRequest = {
      renterId: MOCK_RENTER_ID,
      carrierId: state.selectedCarrierId,
      startDate: state.startDate,
      endDate: state.endDate,
      idempotencyKey,
    };

    const res = await fetch(`${API_URL}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });

    if (!res.ok) throw new Error("Booking failed");

    const booking = await res.json();
    state.bookingId = booking.id;

    // Log checkout steps
    logFunnelEvent("checkout_step1", { step: 1 });
    logFunnelEvent("checkout_step2", { step: 2 });
    logFunnelEvent("checkout_step3", { step: 3 });
    logFunnelEvent("paid", {
      bookingId: booking.id,
      total: booking.totalPrice,
      carrierId: state.selectedCarrierId,
      days: rentalDays,
    });

    state.step = 3;
  } catch (err) {
    state.error = `예약 실패: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[Booking] Error:", err);
  } finally {
    state.loading = false;
  }
}

async function authorizePayment() {
  if (!state.bookingId) return;

  state.loading = true;
  state.error = "";

  try {
    const res = await fetch(`${API_URL}/bookings/${state.bookingId}/authorize-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) throw new Error("Payment authorization failed");

    // Show success message
    render();
  } catch (err) {
    state.error = `결제 승인 실패: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[Payment] Error:", err);
  } finally {
    state.loading = false;
  }
}

async function registerCarrier() {
  if (!state.providerBrand || !state.providerModel || state.providerBasePrice <= 0) {
    state.error = "모든 필드를 입력해주세요.";
    return;
  }

  state.loading = true;
  state.error = "";

  try {
    const req = {
      providerId: MOCK_PROVIDER_ID,
      size: state.providerSize,
      brandModel: `${state.providerBrand} ${state.providerModel}`,
      basePrice: state.providerBasePrice,
      intakePhotoUrl: state.providerPhotoUrl || "https://via.placeholder.com/300",
    };

    const res = await fetch(`${API_URL}/providers/carriers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });

    if (!res.ok) throw new Error("Carrier registration failed");

    const carrier = await res.json();

    // Opt-in if checked
    if (state.providerOptIn) {
      const optInRes = await fetch(`${API_URL}/providers/carriers/${carrier.id}/opt-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!optInRes.ok) throw new Error("Opt-in failed");
    }

    // Reset form
    state.providerBrand = "";
    state.providerModel = "";
    state.providerBasePrice = 0;
    state.providerPhotoUrl = "";
    state.error = "";

    // Reload carriers list
    await fetchProviderCarriers();
  } catch (err) {
    state.error = `등록 실패: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[Provider] Error:", err);
  } finally {
    state.loading = false;
  }
}

async function fetchProviderCarriers() {
  try {
    const res = await fetch(`${API_URL}/providers/${MOCK_PROVIDER_ID}/carriers`);
    if (res.ok) {
      const data = await res.json();
      state.providerCarriers = data.carriers || [];
    }
  } catch (err) {
    console.error("[Provider] Failed to fetch carriers:", err);
  }
}

function render() {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("missing app root");

  const rentalDays = daysBetween(state.startDate, state.endDate);
  const selected = state.searchResults.find((c) => c.id === state.selectedCarrierId);
  const minDays = 2;
  const canSearch = rentalDays >= minDays;
  const canStep2 = !!selected && rentalDays >= minDays;
  const canStep3 = canStep2 && state.customerName.trim().length > 1 && state.customerPhone.length > 7;

  app.innerHTML = `
    <main class="page">
      <header class="topbar">
        <div class="brand">luggy</div>
        <nav class="menu">
          <button data-tab="rent" class="nav-btn ${state.tab === "rent" ? "active" : ""}">렌탈</button>
          <button data-tab="provider" class="nav-btn ${state.tab === "provider" ? "active" : ""}">맡기기</button>
        </nav>
      </header>

      <section class="hero">
        <h1>캐리어 즉시 검색하고 3단계로 결제하세요</h1>
        <p>실제 재고와 연결된 예약 시스템입니다.</p>

        <div class="search-grid">
          <label>대여 시작일<input id="startDate" type="date" value="${state.startDate}" /></label>
          <label>반납일<input id="endDate" type="date" value="${state.endDate}" /></label>
          <label>사이즈
            <select id="size">
              <option value="carry_on" ${state.size === "carry_on" ? "selected" : ""}>기내용</option>
              <option value="medium" ${state.size === "medium" ? "selected" : ""}>중형</option>
            </select>
          </label>
          <button id="searchBtn" class="cta" ${canSearch ? "" : "disabled"} ${state.loading ? "disabled" : ""}>
            ${state.loading ? "검색 중..." : "즉시 조회"}
          </button>
        </div>
        ${rentalDays < minDays ? '<p class="warn">최소 대여기간은 2일입니다.</p>' : ""}
        ${state.error ? `<p class="error">${state.error}</p>` : ""}
      </section>

      ${
        state.tab === "rent"
          ? `
      <section class="layout">
        <section class="results">
          <div class="section-head">
            <h2>렌탈 가능한 캐리어</h2>
            <span>${state.searchResults.length}개</span>
          </div>
          <div class="cards">
            ${
              state.searchResults.length === 0 && !state.loading
                ? '<p class="empty">검색하여 결과를 확인하세요.</p>'
                : state.searchResults
                    .map(
                      (item) => `
              <article class="card ${state.selectedCarrierId === item.id ? "selected" : ""}" data-select="${item.id}">
                <div class="content">
                  <strong>${item.brandModel}</strong>
                  <div class="row meta">
                    <span>⭐ ${item.provider.rating}</span>
                    <span>리뷰 ${item.provider.reviews}</span>
                    <span>남은 수량 ${item.remainingQuantity}개</span>
                  </div>
                  <div class="row between">
                    <strong class="total">${currency(item.totalPrice)}</strong>
                  </div>
                </div>
              </article>
            `
                    )
                    .join("")
            }
          </div>
        </section>

        <aside class="checkout">
          <h3>3단계 결제</h3>
          <div class="steps">
            <button data-step="1" class="step ${state.step === 1 ? "active" : ""}">1. 상품선택</button>
            <button data-step="2" class="step ${state.step === 2 ? "active" : ""}" ${canStep2 ? "" : "disabled"}>2. 정보입력</button>
            <button data-step="3" class="step ${state.step === 3 ? "active" : ""}" ${canStep3 ? "" : "disabled"}>3. 결제</button>
          </div>

          ${
            state.step === 1
              ? `
            <div class="panel">
              <p>선택: <strong>${selected ? selected.brandModel : "미선택"}</strong></p>
              <p>기간: <strong>${rentalDays}일</strong></p>
              <p>가격: <strong>${selected ? currency(selected.totalPrice) : "-"}</strong></p>
              <button id="toStep2" class="cta" ${canStep2 ? "" : "disabled"}>다음</button>
            </div>
          `
              : ""
          }

          ${
            state.step === 2
              ? `
            <div class="panel">
              <label>예약자명<input id="customerName" value="${state.customerName}" /></label>
              <label>연락처<input id="customerPhone" value="${state.customerPhone}" placeholder="010-0000-0000" /></label>
              <button id="toStep3" class="cta" ${canStep3 ? "" : "disabled"}>결제</button>
            </div>
          `
              : ""
          }

          ${
            state.step === 3
              ? `
            <div class="panel">
              ${
                state.bookingId
                  ? `
                <div class="success">
                  <h4>✓ 예약 완료</h4>
                  <p>예약번호: <strong>${state.bookingId}</strong></p>
                  <p>총결제액: <strong>${selected ? currency(selected.totalPrice) : "-"}</strong></p>
                  <button id="payAuthorize" class="cta">결제 승인</button>
                </div>
              `
                  : `
                <button id="bookingBtn" class="cta" ${canStep3 && !state.loading ? "" : "disabled"}>
                  ${state.loading ? "예약 중..." : "예약 생성"}
                </button>
              `
              }
            </div>
          `
              : ""
          }
        </aside>
      </section>
      `
          : `
      <section class="provider-section">
        <h2>캐리어 등록 / 입고</h2>
        <p>사진 업로드 후 렌탈 허용으로 전환하면 Renter가 예약할 수 있습니다.</p>
        
        ${state.error ? `<p class="error">${state.error}</p>` : ""}

        <div class="provider-form">
          <label>사이즈
            <select id="providerSize">
              <option value="carry_on" ${state.providerSize === "carry_on" ? "selected" : ""}>기내용</option>
              <option value="medium" ${state.providerSize === "medium" ? "selected" : ""}>중형</option>
            </select>
          </label>
          <label>브랜드<input id="providerBrand" value="${state.providerBrand}" placeholder="Samsonite" /></label>
          <label>모델<input id="providerModel" value="${state.providerModel}" placeholder="C-Lite" /></label>
          <label>기준가(원)<input id="providerPrice" type="number" value="${state.providerBasePrice || ""}" placeholder="100000" /></label>
          <label>사진
            <input type="file" id="providerPhoto" accept="image/*" />
            ${state.providerPhotoUrl ? `<small style="color: #27ae60;">✓ 사진 선택됨</small>` : '<small>기기에서 사진을 선택하세요</small>'}
          </label>
          <label><input type="checkbox" id="providerOptIn" ${state.providerOptIn ? "checked" : ""} /> 렌탈 허용 동의</label>
          <button id="registerBtn" class="cta" ${state.loading ? "disabled" : ""}>
            ${state.loading ? "등록 중..." : "등록 및 Opt-in"}
          </button>
        </div>

        <div class="provider-list">
          <h3>내 캐리어</h3>
          ${
            state.providerCarriers.length === 0
              ? '<p>등록된 캐리어가 없습니다.</p>'
              : state.providerCarriers
                  .map(
                    (c) => `
            <div class="carrier-item">
              <strong>${c.brandModel}</strong> (${c.size})
              <span class="status ${c.status}">${c.status}</span>
              <span class="optIn ${c.optInRentable ? "active" : ""}">렌탈: ${c.optInRentable ? "허용" : "미허용"}</span>
            </div>
          `
                  )
                  .join("")
          }
        </div>
      </section>
      `
      }
    </main>
  `;

  bindEvents();
}

function bindEvents() {
  // Tab switching
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab as Tab;
      state.step = 1;
      if (state.tab === "provider") {
        fetchProviderCarriers();
      }
      render();
    });
  });

  // Renter flow
  document.querySelector<HTMLInputElement>("#startDate")?.addEventListener("change", (e) => {
    state.startDate = (e.target as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLInputElement>("#endDate")?.addEventListener("change", (e) => {
    state.endDate = (e.target as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLSelectElement>("#size")?.addEventListener("change", (e) => {
    state.size = (e.target as HTMLSelectElement).value as Size;
    state.selectedCarrierId = "";
    render();
  });

  document.querySelector<HTMLButtonElement>("#searchBtn")?.addEventListener("click", () => {
    searchCarriers();
    render();
  });

  document.querySelectorAll<HTMLElement>("[data-select]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedCarrierId = card.dataset.select || "";
      logFunnelEvent("detail_view", { carrierId: state.selectedCarrierId });
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = Number(btn.dataset.step) as Step;
      if (step >= 1 && step <= 3) {
        state.step = step;
        render();
      }
    });
  });

  document.querySelector<HTMLButtonElement>("#toStep2")?.addEventListener("click", () => {
    state.step = 2;
    logFunnelEvent("checkout_step1", { step: 1 });
    render();
  });

  document.querySelector<HTMLInputElement>("#customerName")?.addEventListener("input", (e) => {
    state.customerName = (e.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#customerPhone")?.addEventListener("input", (e) => {
    state.customerPhone = (e.target as HTMLInputElement).value;
  });

  document.querySelector<HTMLButtonElement>("#toStep3")?.addEventListener("click", () => {
    logFunnelEvent("checkout_step2", { step: 2 });
    createBooking();
    render();
  });

  document.querySelector<HTMLButtonElement>("#bookingBtn")?.addEventListener("click", () => {
    createBooking();
  });

  document.querySelector<HTMLButtonElement>("#payAuthorize")?.addEventListener("click", () => {
    authorizePayment();
  });

  // Provider flow
  document.querySelector<HTMLSelectElement>("#providerSize")?.addEventListener("change", (e) => {
    state.providerSize = (e.target as HTMLSelectElement).value as Size;
  });
  document.querySelector<HTMLInputElement>("#providerBrand")?.addEventListener("input", (e) => {
    state.providerBrand = (e.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#providerModel")?.addEventListener("input", (e) => {
    state.providerModel = (e.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#providerPrice")?.addEventListener("input", (e) => {
    state.providerBasePrice = Number((e.target as HTMLInputElement).value) || 0;
  });
  document.querySelector<HTMLInputElement>("#providerPhoto")?.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target?.result as string;
        state.providerPhotoUrl = dataUrl;
        render(); // Re-render to show checkmark
      };
      reader.readAsDataURL(file);
    }
  });
  document.querySelector<HTMLInputElement>("#providerOptIn")?.addEventListener("change", (e) => {
    state.providerOptIn = (e.target as HTMLInputElement).checked;
  });

  document.querySelector<HTMLButtonElement>("#registerBtn")?.addEventListener("click", () => {
    registerCarrier();
  });
}

// Initial render
logFunnelEvent("landing_view", { timestamp: new Date().toISOString() });
render();
