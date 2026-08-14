import "./styles.css";

type Size = "carry_on" | "medium";
type Tab = "rent" | "provider";
type Step = 1 | 2 | 3;
type DeliveryStatus = "접수" | "이동중" | "도착" | "지연";

type Carrier = {
  id: string;
  brand: string;
  model: string;
  size: Size;
  rating: number;
  reviews: number;
  inspected: boolean;
  originalPrice: number;
  etaLabel: string;
  stock: number;
  image: string;
};

const POLICY = {
  minDays: 2,
  roundTripDelivery: 14000,
  dailyPrice: {
    carry_on: 7900,
    medium: 11900
  } as Record<Size, number>,
  deposit: {
    carry_on: 30000,
    medium: 50000
  } as Record<Size, number>
};

const carriers: Carrier[] = [
  {
    id: "c-1",
    brand: "Samsonite",
    model: "C-Lite",
    size: "carry_on",
    rating: 4.9,
    reviews: 312,
    inspected: true,
    originalPrice: 129000,
    etaLabel: "내일 도착",
    stock: 4,
    image:
      "https://images.unsplash.com/photo-1581553680321-4fffae59fccd?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "c-2",
    brand: "RIMOWA",
    model: "Essential Cabin",
    size: "carry_on",
    rating: 4.8,
    reviews: 186,
    inspected: true,
    originalPrice: 149000,
    etaLabel: "오늘 출고",
    stock: 2,
    image:
      "https://images.unsplash.com/photo-1565026057447-bc90a3dceb87?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "c-3",
    brand: "American Tourister",
    model: "Soundbox M",
    size: "medium",
    rating: 4.7,
    reviews: 141,
    inspected: true,
    originalPrice: 169000,
    etaLabel: "모레 도착",
    stock: 3,
    image:
      "https://images.unsplash.com/photo-1506629905607-55b2f0b4e4f4?auto=format&fit=crop&w=1200&q=80"
  }
];

const state = {
  tab: "rent" as Tab,
  step: 1 as Step,
  startDate: futureDate(7),
  endDate: futureDate(9),
  size: "carry_on" as Size,
  location: "서울 강남구",
  selectedCarrierId: "" as string,
  customerName: "",
  customerPhone: "",
  deliveryStatus: "접수" as DeliveryStatus
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
  const validDays = Math.max(0, days);
  return POLICY.dailyPrice[size] * validDays + POLICY.roundTripDelivery;
}

function refundAmount(checkInDate: string, amount: number): number {
  const now = new Date();
  const checkIn = new Date(checkInDate);
  const diffHours = (checkIn.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (diffHours >= 48) return amount;
  if (diffHours >= 24) return Math.floor(amount * 0.5);
  return 0;
}

function recommended(size: Size, days: number) {
  return carriers
    .filter((carrier) => carrier.size === size)
    .map((carrier) => {
      const total = totalPrice(size, days);
      const score = carrier.rating * 100 + carrier.reviews * 0.25 + (carrier.stock <= 2 ? 16 : 8);
      return { ...carrier, total, score };
    })
    .sort((a, b) => b.score - a.score);
}

function currentSelection(days: number) {
  const items = recommended(state.size, days);
  return items.find((item) => item.id === state.selectedCarrierId) ?? null;
}

function render() {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("missing app root");

  const rentalDays = daysBetween(state.startDate, state.endDate);
  const items = recommended(state.size, rentalDays);
  const selected = currentSelection(rentalDays);
  const canSearch = rentalDays >= POLICY.minDays && state.location.trim().length > 0;
  const canStep2 = !!selected && selected.stock > 0 && rentalDays >= POLICY.minDays;
  const canStep3 = canStep2 && state.customerName.trim().length > 1 && state.customerPhone.trim().length > 7;

  app.innerHTML = `
    <main class="page">
      <header class="topbar">
        <div class="brand">luggy</div>
        <nav class="menu">
          <button data-tab="rent" class="nav-btn ${state.tab === "rent" ? "active" : ""}">렌탈</button>
          <button data-tab="provider" class="nav-btn ${state.tab === "provider" ? "active" : ""}">맡기기</button>
          <button class="nav-btn ghost">내 예약</button>
          <button class="nav-btn ghost">정책</button>
        </nav>
      </header>

      <section class="hero">
        <h1>Agoda/Hotels 스타일로 캐리어를 즉시 검색하고 3단계로 결제하세요</h1>
        <p>검색 → 상세 선택 → 결제(옵션선택/정보입력/결제)까지 동적 퍼널로 동작합니다.</p>

        <div class="search-grid">
          <label>대여 시작일<input id="startDate" type="date" value="${state.startDate}" /></label>
          <label>반납일<input id="endDate" type="date" value="${state.endDate}" /></label>
          <label>사이즈
            <select id="size">
              <option value="carry_on" ${state.size === "carry_on" ? "selected" : ""}>기내용</option>
              <option value="medium" ${state.size === "medium" ? "selected" : ""}>중형</option>
            </select>
          </label>
          <label>수령지<input id="location" type="text" value="${state.location}" /></label>
          <button id="searchBtn" class="cta" ${canSearch ? "" : "disabled"}>즉시 조회</button>
        </div>
        ${rentalDays < POLICY.minDays ? '<p class="warn">최소 대여기간은 2일입니다.</p>' : ""}
      </section>

      ${
        state.tab === "rent"
          ? `
      <section class="layout">
        <section class="results">
          <div class="section-head">
            <h2>추천순 결과</h2>
            <span>${items.length}개</span>
          </div>
          <div class="cards">
            ${items
              .map(
                (item) => `
              <article class="card ${state.selectedCarrierId === item.id ? "selected" : ""}" data-select="${item.id}">
                <img src="${item.image}" alt="${item.brand} ${item.model}" />
                <div class="content">
                  <div class="row between">
                    <strong>${item.brand} ${item.model}</strong>
                    <span class="badge">${item.inspected ? "검수완료" : "검수대기"}</span>
                  </div>
                  <div class="row meta">
                    <span>⭐ ${item.rating}</span>
                    <span>리뷰 ${item.reviews}</span>
                    <span>남은 수량 ${item.stock}개</span>
                    <span>${item.etaLabel}</span>
                  </div>
                  <div class="row between">
                    <del>${currency(item.originalPrice)}</del>
                    <strong class="total">${currency(item.total)}</strong>
                  </div>
                  <p class="scarcity">${item.stock <= 2 ? "마감 임박" : "재고 여유"}</p>
                </div>
              </article>
            `
              )
              .join("")}
          </div>
        </section>

        <aside class="checkout">
          <h3>3단계 결제</h3>
          <div class="steps">
            <button data-step="1" class="step ${state.step === 1 ? "active" : ""}">1. 옵션선택</button>
            <button data-step="2" class="step ${state.step === 2 ? "active" : ""}" ${canStep2 ? "" : "disabled"}>2. 정보입력</button>
            <button data-step="3" class="step ${state.step === 3 ? "active" : ""}" ${canStep3 ? "" : "disabled"}>3. 결제</button>
          </div>

          ${
            state.step === 1
              ? `
            <div class="panel">
              <p>선택 상품: <strong>${selected ? `${selected.brand} ${selected.model}` : "미선택"}</strong></p>
              <p>대여기간: <strong>${rentalDays}일</strong></p>
              <p>왕복배송비: <strong>${currency(POLICY.roundTripDelivery)}</strong></p>
              <p>총결제액: <strong>${selected ? currency(selected.total) : "-"}</strong></p>
              <button id="toStep2" class="cta" ${canStep2 ? "" : "disabled"}>다음 단계</button>
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
              <button id="toStep3" class="cta" ${canStep3 ? "" : "disabled"}>결제 단계로</button>
            </div>
          `
              : ""
          }

          ${
            state.step === 3
              ? `
            <div class="panel">
              <p>보증금: <strong>${selected ? currency(POLICY.deposit[selected.size]) : "-"}</strong></p>
              <p>배송상태:
                <select id="deliveryStatus">
                  <option ${state.deliveryStatus === "접수" ? "selected" : ""}>접수</option>
                  <option ${state.deliveryStatus === "이동중" ? "selected" : ""}>이동중</option>
                  <option ${state.deliveryStatus === "도착" ? "selected" : ""}>도착</option>
                  <option ${state.deliveryStatus === "지연" ? "selected" : ""}>지연</option>
                </select>
              </p>
              <button id="payNow" class="cta" ${canStep3 ? "" : "disabled"}>결제 승인</button>
            </div>
          `
              : ""
          }

          <div id="bookingResult"></div>
        </aside>
      </section>
      `
          : `
      <section class="provider">
        <h2>Provider 등록/입고/Opt-in</h2>
        <p>입고 신청 → 검수 사진 업로드 → 렌탈 Opt-in으로 진행됩니다.</p>
        <div class="provider-grid">
          <label>캐리어 사이즈<select><option>기내용</option><option>중형</option></select></label>
          <label>브랜드/모델<input placeholder="예: Samsonite C-Lite" /></label>
          <label>희망 입고일<input type="date" value="${futureDate(3)}" /></label>
          <label class="check"><input type="checkbox" checked /> 렌탈 허용 Opt-in 동의</label>
          <button class="cta">입고 신청</button>
        </div>
      </section>
      `
      }
    </main>
  `;

  bindEvents();
}

function showResult(message: string) {
  const box = document.querySelector<HTMLDivElement>("#bookingResult");
  if (!box) return;
  box.innerHTML = message;
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab as Tab;
      state.step = 1;
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("#searchBtn")?.addEventListener("click", () => {
    state.step = 1;
    state.selectedCarrierId = "";
    showResult("");
    render();
  });

  document.querySelector<HTMLInputElement>("#startDate")?.addEventListener("change", (event) => {
    state.startDate = (event.target as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLInputElement>("#endDate")?.addEventListener("change", (event) => {
    state.endDate = (event.target as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLSelectElement>("#size")?.addEventListener("change", (event) => {
    state.size = (event.target as HTMLSelectElement).value as Size;
    state.selectedCarrierId = "";
    render();
  });
  document.querySelector<HTMLInputElement>("#location")?.addEventListener("input", (event) => {
    state.location = (event.target as HTMLInputElement).value;
  });

  document.querySelectorAll<HTMLElement>("[data-select]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedCarrierId = card.dataset.select ?? "";
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => {
    button.addEventListener("click", () => {
      state.step = Number(button.dataset.step) as Step;
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("#toStep2")?.addEventListener("click", () => {
    state.step = 2;
    render();
  });

  document.querySelector<HTMLInputElement>("#customerName")?.addEventListener("input", (event) => {
    state.customerName = (event.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#customerPhone")?.addEventListener("input", (event) => {
    state.customerPhone = (event.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLButtonElement>("#toStep3")?.addEventListener("click", () => {
    state.step = 3;
    render();
  });
  document.querySelector<HTMLSelectElement>("#deliveryStatus")?.addEventListener("change", (event) => {
    state.deliveryStatus = (event.target as HTMLSelectElement).value as DeliveryStatus;
  });

  document.querySelector<HTMLButtonElement>("#payNow")?.addEventListener("click", () => {
    const rentalDays = daysBetween(state.startDate, state.endDate);
    const selected = currentSelection(rentalDays);
    if (!selected) return;
    const total = totalPrice(selected.size, rentalDays);
    const refundNow = refundAmount(state.startDate, total);
    const bookingId = `BK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    showResult(`
      <div class="result">
        <h4>예약 완료</h4>
        <p>예약번호: <strong>${bookingId}</strong></p>
        <p>총결제액: <strong>${currency(total)}</strong></p>
        <p>보증금: <strong>${currency(POLICY.deposit[selected.size])}</strong></p>
        <p>배송상태: <strong>${state.deliveryStatus}</strong></p>
        <p>지금 취소 시 환불액: <strong>${currency(refundNow)}</strong></p>
      </div>
    `);
  });
}

render();
