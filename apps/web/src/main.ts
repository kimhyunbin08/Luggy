import './styles.css';

type RegionSnapshot = {
  name: string;
  avgDailyPrice: number;
  inStock: number;
  delayedDeliveries: number;
};

const regionSnapshots: RegionSnapshot[] = [
  { name: '서울', avgDailyPrice: 9100, inStock: 38, delayedDeliveries: 1 },
  { name: '부산', avgDailyPrice: 8700, inStock: 16, delayedDeliveries: 0 },
  { name: '제주', avgDailyPrice: 9400, inStock: 12, delayedDeliveries: 2 }
];

function currency(value: number): string {
  return `${value.toLocaleString('ko-KR')}원`;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing app root');

app.innerHTML = `
  <main class="page">
    <nav class="top-nav">
      <div class="brand">luggy</div>
      <div class="nav-links">
        <button class="tab active">렌탈하기</button>
        <button class="tab">맡기기</button>
        <button class="tab">내 예약</button>
        <button class="tab">정책 안내</button>
      </div>
    </nav>

    <header class="hero">
      <div class="switch">
        <button class="switch-btn active">렌탈하기</button>
        <button class="switch-btn">맡기기</button>
      </div>
      <div class="hero-grid">
        <section class="mode-panel">
          <p class="eyebrow">Luggy Rental</p>
          <h1>내 지역 캐리어 렌탈 시세와 재고를 바로 확인하세요</h1>
          <p class="sub">검색 → 상세 → 3단계 결제로 이어지는 MVP 퍼널을 첫 화면에서 시작합니다.</p>
          <form class="search-form" aria-label="렌탈 검색">
            <label>대여 시작일<input type="date" required /></label>
            <label>반납일<input type="date" required /></label>
            <label>사이즈
              <select>
                <option value="carry_on">기내용</option>
                <option value="medium">중형</option>
              </select>
            </label>
            <label>수령지<input type="text" placeholder="예: 서울 강남구" required /></label>
            <button type="submit">즉시 조회</button>
          </form>
        </section>

        <section class="mode-panel provider">
          <p class="eyebrow">Luggy Provider</p>
          <h2>캐리어를 맡기고 렌탈 수익을 시작하세요</h2>
          <p class="sub">입고 신청 → 검수 → 렌탈 Opt-in 순서로 진행됩니다.</p>
          <form class="provider-form" aria-label="입고 신청">
            <label>캐리어 사이즈
              <select>
                <option value="carry_on">기내용</option>
                <option value="medium">중형</option>
              </select>
            </label>
            <label>브랜드/모델<input type="text" placeholder="예: Samsonite C-Lite" /></label>
            <label>희망 입고일<input type="date" /></label>
            <label class="check"><input type="checkbox" checked /> 렌탈 허용 Opt-in 동의</label>
            <button type="button">맡기기 신청</button>
          </form>
        </section>
      </div>
    </header>

    <section class="panel">
      <h2>우리 지역 현황</h2>
      <div class="grid">
        ${regionSnapshots
          .map(
            (row) => `
            <article class="card">
              <h3>${row.name}</h3>
              <p>평균 일요금: <strong>${currency(row.avgDailyPrice)}</strong></p>
              <p>즉시 예약 가능 수량: <strong>${row.inStock}개</strong></p>
              <p>지연 배송 건수(24h): <strong>${row.delayedDeliveries}건</strong></p>
            </article>
          `
          )
          .join('')}
      </div>
    </section>
  </main>
`;
