(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e={minDays:2,roundTripDelivery:14e3,dailyPrice:{carry_on:7900,medium:11900},deposit:{carry_on:3e4,medium:5e4}},t=[{id:`c-1`,brand:`Samsonite`,model:`C-Lite`,size:`carry_on`,rating:4.9,reviews:312,inspected:!0,originalPrice:129e3,etaLabel:`내일 도착`,stock:4,image:`https://images.unsplash.com/photo-1581553680321-4fffae59fccd?auto=format&fit=crop&w=1200&q=80`},{id:`c-2`,brand:`RIMOWA`,model:`Essential Cabin`,size:`carry_on`,rating:4.8,reviews:186,inspected:!0,originalPrice:149e3,etaLabel:`오늘 출고`,stock:2,image:`https://images.unsplash.com/photo-1565026057447-bc90a3dceb87?auto=format&fit=crop&w=1200&q=80`},{id:`c-3`,brand:`American Tourister`,model:`Soundbox M`,size:`medium`,rating:4.7,reviews:141,inspected:!0,originalPrice:169e3,etaLabel:`모레 도착`,stock:3,image:`https://images.unsplash.com/photo-1506629905607-55b2f0b4e4f4?auto=format&fit=crop&w=1200&q=80`}],n={tab:`rent`,step:1,startDate:r(7),endDate:r(9),size:`carry_on`,location:`서울 강남구`,selectedCarrierId:``,customerName:``,customerPhone:``,deliveryStatus:`접수`};function r(e){let t=new Date;return t.setDate(t.getDate()+e),t.toISOString().slice(0,10)}function i(e,t){let n=new Date(e),r=new Date(t);return Math.ceil((r.getTime()-n.getTime())/864e5)}function a(e){return`${e.toLocaleString(`ko-KR`)}원`}function o(t,n){let r=Math.max(0,n);return e.dailyPrice[t]*r+e.roundTripDelivery}function s(e,t){let n=new Date,r=(new Date(e).getTime()-n.getTime())/36e5;return r>=48?t:r>=24?Math.floor(t*.5):0}function c(e,n){return t.filter(t=>t.size===e).map(t=>{let r=o(e,n),i=t.rating*100+t.reviews*.25+(t.stock<=2?16:8);return{...t,total:r,score:i}}).sort((e,t)=>t.score-e.score)}function l(e){return c(n.size,e).find(e=>e.id===n.selectedCarrierId)??null}function u(){let t=document.querySelector(`#app`);if(!t)throw Error(`missing app root`);let o=i(n.startDate,n.endDate),s=c(n.size,o),u=l(o),d=o>=e.minDays&&n.location.trim().length>0,p=!!u&&u.stock>0&&o>=e.minDays,m=p&&n.customerName.trim().length>1&&n.customerPhone.trim().length>7;t.innerHTML=`
    <main class="page">
      <header class="topbar">
        <div class="brand">luggy</div>
        <nav class="menu">
          <button data-tab="rent" class="nav-btn ${n.tab===`rent`?`active`:``}">렌탈</button>
          <button data-tab="provider" class="nav-btn ${n.tab===`provider`?`active`:``}">맡기기</button>
          <button class="nav-btn ghost">내 예약</button>
          <button class="nav-btn ghost">정책</button>
        </nav>
      </header>

      <section class="hero">
        <h1>Agoda/Hotels 스타일로 캐리어를 즉시 검색하고 3단계로 결제하세요</h1>
        <p>검색 → 상세 선택 → 결제(옵션선택/정보입력/결제)까지 동적 퍼널로 동작합니다.</p>

        <div class="search-grid">
          <label>대여 시작일<input id="startDate" type="date" value="${n.startDate}" /></label>
          <label>반납일<input id="endDate" type="date" value="${n.endDate}" /></label>
          <label>사이즈
            <select id="size">
              <option value="carry_on" ${n.size===`carry_on`?`selected`:``}>기내용</option>
              <option value="medium" ${n.size===`medium`?`selected`:``}>중형</option>
            </select>
          </label>
          <label>수령지<input id="location" type="text" value="${n.location}" /></label>
          <button id="searchBtn" class="cta" ${d?``:`disabled`}>즉시 조회</button>
        </div>
        ${o<e.minDays?`<p class="warn">최소 대여기간은 2일입니다.</p>`:``}
      </section>

      ${n.tab===`rent`?`
      <section class="layout">
        <section class="results">
          <div class="section-head">
            <h2>추천순 결과</h2>
            <span>${s.length}개</span>
          </div>
          <div class="cards">
            ${s.map(e=>`
              <article class="card ${n.selectedCarrierId===e.id?`selected`:``}" data-select="${e.id}">
                <img src="${e.image}" alt="${e.brand} ${e.model}" />
                <div class="content">
                  <div class="row between">
                    <strong>${e.brand} ${e.model}</strong>
                    <span class="badge">${e.inspected?`검수완료`:`검수대기`}</span>
                  </div>
                  <div class="row meta">
                    <span>⭐ ${e.rating}</span>
                    <span>리뷰 ${e.reviews}</span>
                    <span>남은 수량 ${e.stock}개</span>
                    <span>${e.etaLabel}</span>
                  </div>
                  <div class="row between">
                    <del>${a(e.originalPrice)}</del>
                    <strong class="total">${a(e.total)}</strong>
                  </div>
                  <p class="scarcity">${e.stock<=2?`마감 임박`:`재고 여유`}</p>
                </div>
              </article>
            `).join(``)}
          </div>
        </section>

        <aside class="checkout">
          <h3>3단계 결제</h3>
          <div class="steps">
            <button data-step="1" class="step ${n.step===1?`active`:``}">1. 옵션선택</button>
            <button data-step="2" class="step ${n.step===2?`active`:``}" ${p?``:`disabled`}>2. 정보입력</button>
            <button data-step="3" class="step ${n.step===3?`active`:``}" ${m?``:`disabled`}>3. 결제</button>
          </div>

          ${n.step===1?`
            <div class="panel">
              <p>선택 상품: <strong>${u?`${u.brand} ${u.model}`:`미선택`}</strong></p>
              <p>대여기간: <strong>${o}일</strong></p>
              <p>왕복배송비: <strong>${a(e.roundTripDelivery)}</strong></p>
              <p>총결제액: <strong>${u?a(u.total):`-`}</strong></p>
              <button id="toStep2" class="cta" ${p?``:`disabled`}>다음 단계</button>
            </div>
          `:``}

          ${n.step===2?`
            <div class="panel">
              <label>예약자명<input id="customerName" value="${n.customerName}" /></label>
              <label>연락처<input id="customerPhone" value="${n.customerPhone}" placeholder="010-0000-0000" /></label>
              <button id="toStep3" class="cta" ${m?``:`disabled`}>결제 단계로</button>
            </div>
          `:``}

          ${n.step===3?`
            <div class="panel">
              <p>보증금: <strong>${u?a(e.deposit[u.size]):`-`}</strong></p>
              <p>배송상태:
                <select id="deliveryStatus">
                  <option ${n.deliveryStatus===`접수`?`selected`:``}>접수</option>
                  <option ${n.deliveryStatus===`이동중`?`selected`:``}>이동중</option>
                  <option ${n.deliveryStatus===`도착`?`selected`:``}>도착</option>
                  <option ${n.deliveryStatus===`지연`?`selected`:``}>지연</option>
                </select>
              </p>
              <button id="payNow" class="cta" ${m?``:`disabled`}>결제 승인</button>
            </div>
          `:``}

          <div id="bookingResult"></div>
        </aside>
      </section>
      `:`
      <section class="provider">
        <h2>Provider 등록/입고/Opt-in</h2>
        <p>입고 신청 → 검수 사진 업로드 → 렌탈 Opt-in으로 진행됩니다.</p>
        <div class="provider-grid">
          <label>캐리어 사이즈<select><option>기내용</option><option>중형</option></select></label>
          <label>브랜드/모델<input placeholder="예: Samsonite C-Lite" /></label>
          <label>희망 입고일<input type="date" value="${r(3)}" /></label>
          <label class="check"><input type="checkbox" checked /> 렌탈 허용 Opt-in 동의</label>
          <button class="cta">입고 신청</button>
        </div>
      </section>
      `}
    </main>
  `,f()}function d(e){let t=document.querySelector(`#bookingResult`);t&&(t.innerHTML=e)}function f(){document.querySelectorAll(`[data-tab]`).forEach(e=>{e.addEventListener(`click`,()=>{n.tab=e.dataset.tab,n.step=1,u()})}),document.querySelector(`#searchBtn`)?.addEventListener(`click`,()=>{n.step=1,n.selectedCarrierId=``,d(``),u()}),document.querySelector(`#startDate`)?.addEventListener(`change`,e=>{n.startDate=e.target.value,u()}),document.querySelector(`#endDate`)?.addEventListener(`change`,e=>{n.endDate=e.target.value,u()}),document.querySelector(`#size`)?.addEventListener(`change`,e=>{n.size=e.target.value,n.selectedCarrierId=``,u()}),document.querySelector(`#location`)?.addEventListener(`input`,e=>{n.location=e.target.value}),document.querySelectorAll(`[data-select]`).forEach(e=>{e.addEventListener(`click`,()=>{n.selectedCarrierId=e.dataset.select??``,u()})}),document.querySelectorAll(`[data-step]`).forEach(e=>{e.addEventListener(`click`,()=>{n.step=Number(e.dataset.step),u()})}),document.querySelector(`#toStep2`)?.addEventListener(`click`,()=>{n.step=2,u()}),document.querySelector(`#customerName`)?.addEventListener(`input`,e=>{n.customerName=e.target.value}),document.querySelector(`#customerPhone`)?.addEventListener(`input`,e=>{n.customerPhone=e.target.value}),document.querySelector(`#toStep3`)?.addEventListener(`click`,()=>{n.step=3,u()}),document.querySelector(`#deliveryStatus`)?.addEventListener(`change`,e=>{n.deliveryStatus=e.target.value}),document.querySelector(`#payNow`)?.addEventListener(`click`,()=>{let t=i(n.startDate,n.endDate),r=l(t);if(!r)return;let c=o(r.size,t),u=s(n.startDate,c);d(`
      <div class="result">
        <h4>예약 완료</h4>
        <p>예약번호: <strong>${`BK-${Math.random().toString(36).slice(2,8).toUpperCase()}`}</strong></p>
        <p>총결제액: <strong>${a(c)}</strong></p>
        <p>보증금: <strong>${a(e.deposit[r.size])}</strong></p>
        <p>배송상태: <strong>${n.deliveryStatus}</strong></p>
        <p>지금 취소 시 환불액: <strong>${a(u)}</strong></p>
      </div>
    `)})}u();