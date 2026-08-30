// 동네 직거래(P2P Direct Deal) 파일럿 UI — prd.md §19 / trd.md §16.
//
// Self-contained sibling module to main.ts (same precedent as funnel.ts):
// does NOT import from main.ts to avoid a circular import, so small helpers
// (API_URL/responseError/photo upload) are intentionally duplicated here in
// miniature rather than shared. main.ts only needs to call the exported
// initP2pTab/stopP2pTab/renderP2pTab/bindP2pEvents functions.
//
// Covers: email/password auth, Kakao Map carrier browsing, AI photo/chat
// assisted registration (draft the user reviews/edits before submitting),
// and deal request + 1:1 chat. None of this touches legacy bookings/
// payments/inspections tables or endpoints.

type Size = "carry_on" | "medium";
type P2pView = "map" | "register" | "requests";
type DealStatus = "requested" | "accepted" | "declined" | "cancelled" | "completed";

type AuthUser = { id: string; email: string; name: string; phone?: string | null };

type MapCarrier = {
  id: string;
  size: Size;
  brand?: string;
  model?: string;
  brandModel?: string;
  basePrice: number;
  thumbnailUrl?: string;
  dong?: string;
  latitude?: number;
  longitude?: number;
};

type DealRequestRecord = {
  id: string;
  carrierId: string;
  requesterId: string;
  ownerId: string;
  status: DealStatus;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
};

type ChatMessageRecord = {
  id: string;
  dealRequestId: string;
  senderId: string;
  body: string;
  createdAt: string;
};

type CarrierDraft = {
  brand?: string;
  model?: string;
  size?: Size;
  condition?: string;
  confidence?: number;
};

type ChatDraftMessage = { role: "user" | "assistant"; content: string };

declare global {
  interface Window {
    kakao?: any;
  }
}

const API_URL = (import.meta as any).env?.VITE_API_URL || "http://localhost:3001";
const KAKAO_MAP_KEY = (import.meta as any).env?.VITE_KAKAO_MAP_KEY || "";
const TOKEN_STORAGE_KEY = "luggy_p2p_token";

function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (char) => entities[char] || char);
}

function currency(value: number | string): string {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function sizeLabel(size: Size | undefined): string {
  return size === "medium" ? "중형" : "기내용";
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null);
  return new Error(payload?.error || fallback);
}

const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  requested: "요청됨",
  accepted: "수락됨",
  declined: "거절됨",
  cancelled: "취소됨",
  completed: "완료",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const p2pState = {
  view: "map" as P2pView,
  token: (typeof localStorage !== "undefined" && localStorage.getItem(TOKEN_STORAGE_KEY)) || "",
  user: null as AuthUser | null,
  authResolved: false,

  authMode: "login" as "login" | "signup",
  authEmail: "",
  authPassword: "",
  authName: "",
  authPhone: "",
  authLoading: false,
  authError: "",

  mapLoading: false,
  mapCarriers: [] as MapCarrier[],
  mapSize: "" as "" | Size,
  selectedMapCarrierId: "",
  requestMessage: "",
  requestStartDate: "",
  requestEndDate: "",
  requestSubmitting: false,
  requestError: "",
  requestNotice: "",

  regMode: "manual" as "manual" | "chat",
  regBrand: "",
  regModel: "",
  regSize: "carry_on" as Size,
  regDong: "",
  regLatitude: undefined as number | undefined,
  regLongitude: undefined as number | undefined,
  regPrice: 0,
  regPhotoUrl: "",
  regPhotoUploading: false,
  regAiLoading: false,
  regAiError: "",
  regSubmitting: false,
  regNotice: "",
  regError: "",

  chatDraftMessages: [] as ChatDraftMessage[],
  chatDraftInput: "",
  chatDraftLoading: false,
  chatDraftError: "",

  deals: [] as DealRequestRecord[],
  dealsLoading: false,
  dealsError: "",
  activeDealId: "",
  activeDeal: null as DealRequestRecord | null,
  activeDealMessages: [] as ChatMessageRecord[],
  dealMessageInput: "",
  dealActionLoading: false,
};

let rerenderApp: () => void = () => {};
function rerenderP2p(): void {
  rerenderApp();
}

let chatPollTimer: ReturnType<typeof setInterval> | null = null;
function stopChatPolling(): void {
  if (chatPollTimer !== null) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  return p2pState.token ? { Authorization: `Bearer ${p2pState.token}` } : {};
}

function saveToken(token: string): void {
  p2pState.token = token;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage unavailable (private mode etc.) — token still works for this tab session.
  }
}

function clearAuth(): void {
  p2pState.token = "";
  p2pState.user = null;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function fetchMe(): Promise<void> {
  if (!p2pState.token) {
    p2pState.authResolved = true;
    return;
  }
  try {
    const response = await fetch(`${API_URL}/auth/me`, { headers: authHeaders() });
    if (!response.ok) {
      clearAuth();
      return;
    }
    const data = await response.json();
    p2pState.user = data.user;
  } catch (error) {
    console.error("[P2P] Failed to fetch current user:", error);
  } finally {
    p2pState.authResolved = true;
  }
}

async function submitAuthForm(): Promise<void> {
  const isSignup = p2pState.authMode === "signup";
  if (!p2pState.authEmail.trim() || !p2pState.authPassword.trim() || (isSignup && !p2pState.authName.trim())) {
    p2pState.authError = "필수 항목을 모두 입력해주세요.";
    rerenderP2p();
    return;
  }

  p2pState.authLoading = true;
  p2pState.authError = "";
  rerenderP2p();

  try {
    const response = await fetch(`${API_URL}/auth/${isSignup ? "signup" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isSignup
          ? {
              email: p2pState.authEmail.trim(),
              password: p2pState.authPassword,
              name: p2pState.authName.trim(),
              phone: p2pState.authPhone.trim() || undefined,
            }
          : { email: p2pState.authEmail.trim(), password: p2pState.authPassword },
      ),
    });
    if (!response.ok) throw await responseError(response, isSignup ? "회원가입에 실패했습니다." : "로그인에 실패했습니다.");
    const data = await response.json();
    saveToken(data.token);
    p2pState.user = data.user;
    p2pState.authEmail = "";
    p2pState.authPassword = "";
    p2pState.authName = "";
    p2pState.authPhone = "";
  } catch (error) {
    p2pState.authError = error instanceof Error ? error.message : String(error);
  } finally {
    p2pState.authLoading = false;
    rerenderP2p();
  }
}

function logout(): void {
  clearAuth();
  p2pState.deals = [];
  p2pState.activeDealId = "";
  p2pState.activeDeal = null;
  p2pState.activeDealMessages = [];
  stopChatPolling();
  rerenderP2p();
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

async function fetchMapCarriers(): Promise<void> {
  p2pState.mapLoading = true;
  rerenderP2p();
  try {
    const query = p2pState.mapSize ? `?size=${p2pState.mapSize}` : "";
    const response = await fetch(`${API_URL}/carriers/map${query}`);
    if (!response.ok) throw await responseError(response, "캐리어 지도를 불러오지 못했습니다.");
    const data = await response.json();
    p2pState.mapCarriers = Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    console.error("[P2P] Failed to fetch map carriers:", error);
  } finally {
    p2pState.mapLoading = false;
    rerenderP2p();
  }
}

let kakaoSdkPromise: Promise<any> | null = null;
function loadKakaoSdk(): Promise<any> {
  if (!KAKAO_MAP_KEY) return Promise.reject(new Error("Kakao Map API 키가 설정되지 않았습니다."));
  if (window.kakao?.maps) return Promise.resolve(window.kakao);
  if (kakaoSdkPromise) return kakaoSdkPromise;
  kakaoSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_MAP_KEY)}&autoload=false`;
    script.onload = () => window.kakao!.maps.load(() => resolve(window.kakao));
    script.onerror = () => reject(new Error("Kakao Maps SDK 로드에 실패했습니다."));
    document.head.appendChild(script);
  });
  return kakaoSdkPromise;
}

// Re-created against the fresh container element on every render (the whole
// #app subtree is replaced on each render() call in main.ts, so the old map
// canvas is already detached from the document by the time this runs again).
async function mountKakaoMapIfNeeded(): Promise<void> {
  if (!KAKAO_MAP_KEY || p2pState.view !== "map") return;
  const el = document.getElementById("p2pMapEl");
  if (!el) return;

  try {
    const kakao = await loadKakaoSdk();
    const geo = p2pState.mapCarriers.filter(
      (c): c is MapCarrier & { latitude: number; longitude: number } =>
        typeof c.latitude === "number" && typeof c.longitude === "number",
    );
    const center = geo.length
      ? new kakao.maps.LatLng(geo[0].latitude, geo[0].longitude)
      : new kakao.maps.LatLng(37.5665, 126.978); // Seoul City Hall fallback
    const map = new kakao.maps.Map(el, { center, level: 6 });

    if (geo.length > 1) {
      const bounds = new kakao.maps.LatLngBounds();
      geo.forEach((c) => bounds.extend(new kakao.maps.LatLng(c.latitude, c.longitude)));
      map.setBounds(bounds);
    }

    geo.forEach((carrier) => {
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(carrier.latitude, carrier.longitude),
        map,
      });
      kakao.maps.event.addListener(marker, "click", () => {
        p2pState.selectedMapCarrierId = carrier.id;
        rerenderP2p();
      });
    });
  } catch (error) {
    console.error("[P2P] Kakao 지도 마운트 실패:", error);
  }
}

function carrierLabel(carrier: MapCarrier): string {
  return carrier.brandModel || [carrier.brand, carrier.model].filter(Boolean).join(" ") || "이름 미등록 캐리어";
}

// ---------------------------------------------------------------------------
// Deal requests
// ---------------------------------------------------------------------------

async function submitDealRequest(carrierId: string): Promise<void> {
  if (!p2pState.user) {
    p2pState.requestError = "요청을 보내려면 먼저 로그인해주세요.";
    rerenderP2p();
    return;
  }
  if (!p2pState.requestMessage.trim()) {
    p2pState.requestError = "메시지를 입력해주세요.";
    rerenderP2p();
    return;
  }

  p2pState.requestSubmitting = true;
  p2pState.requestError = "";
  rerenderP2p();

  try {
    const response = await fetch(`${API_URL}/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        carrierId,
        message: p2pState.requestMessage.trim(),
        startDate: p2pState.requestStartDate || undefined,
        endDate: p2pState.requestEndDate || undefined,
      }),
    });
    if (!response.ok) throw await responseError(response, "요청을 보내지 못했습니다.");
    const deal: DealRequestRecord = await response.json();

    p2pState.requestMessage = "";
    p2pState.requestStartDate = "";
    p2pState.requestEndDate = "";
    p2pState.selectedMapCarrierId = "";
    p2pState.requestNotice = "요청을 보냈습니다. '내 요청'에서 대화를 이어갈 수 있어요.";
    p2pState.view = "requests";
    await fetchDeals();
    await openDeal(deal.id);
  } catch (error) {
    p2pState.requestError = error instanceof Error ? error.message : String(error);
  } finally {
    p2pState.requestSubmitting = false;
    rerenderP2p();
  }
}

async function fetchDeals(): Promise<void> {
  if (!p2pState.user) return;
  p2pState.dealsLoading = true;
  rerenderP2p();
  try {
    const response = await fetch(`${API_URL}/deals`, { headers: authHeaders() });
    if (!response.ok) throw await responseError(response, "요청 목록을 불러오지 못했습니다.");
    const data = await response.json();
    p2pState.deals = Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    p2pState.dealsError = error instanceof Error ? error.message : String(error);
  } finally {
    p2pState.dealsLoading = false;
    rerenderP2p();
  }
}

async function openDeal(dealId: string): Promise<void> {
  p2pState.activeDealId = dealId;
  stopChatPolling();
  await refreshActiveDeal(true);
  chatPollTimer = setInterval(() => void refreshActiveDeal(false), 4000);
  rerenderP2p();
}

async function refreshActiveDeal(forceRerender: boolean): Promise<void> {
  if (!p2pState.activeDealId) return;
  try {
    const [dealResponse, messagesResponse] = await Promise.all([
      fetch(`${API_URL}/deals/${p2pState.activeDealId}`, { headers: authHeaders() }),
      fetch(`${API_URL}/deals/${p2pState.activeDealId}/messages`, { headers: authHeaders() }),
    ]);
    if (!dealResponse.ok || !messagesResponse.ok) return;
    const deal: DealRequestRecord = await dealResponse.json();
    const messagesData = await messagesResponse.json();
    const messages: ChatMessageRecord[] = Array.isArray(messagesData.items) ? messagesData.items : [];

    const changed = messages.length !== p2pState.activeDealMessages.length || deal.status !== p2pState.activeDeal?.status;
    p2pState.activeDeal = deal;
    p2pState.activeDealMessages = messages;
    if (forceRerender || changed) rerenderP2p();
  } catch (error) {
    console.error("[P2P] Failed to refresh deal chat:", error);
  }
}

async function sendDealMessage(): Promise<void> {
  const body = p2pState.dealMessageInput.trim();
  if (!body || !p2pState.activeDealId) return;
  p2pState.dealMessageInput = "";
  try {
    const response = await fetch(`${API_URL}/deals/${p2pState.activeDealId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) throw await responseError(response, "메시지를 보내지 못했습니다.");
    await refreshActiveDeal(true);
  } catch (error) {
    p2pState.dealsError = error instanceof Error ? error.message : String(error);
    rerenderP2p();
  }
}

async function updateActiveDealStatus(status: DealStatus): Promise<void> {
  if (!p2pState.activeDealId) return;
  p2pState.dealActionLoading = true;
  rerenderP2p();
  try {
    const response = await fetch(`${API_URL}/deals/${p2pState.activeDealId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw await responseError(response, "상태를 변경하지 못했습니다.");
    await refreshActiveDeal(true);
    await fetchDeals();
  } catch (error) {
    p2pState.dealsError = error instanceof Error ? error.message : String(error);
  } finally {
    p2pState.dealActionLoading = false;
    rerenderP2p();
  }
}

// ---------------------------------------------------------------------------
// AI-assisted registration
// ---------------------------------------------------------------------------

function applyDraft(draft: CarrierDraft): void {
  if (draft.brand) p2pState.regBrand = draft.brand;
  if (draft.model) p2pState.regModel = draft.model;
  if (draft.size) p2pState.regSize = draft.size;
}

async function uploadCarrierPhoto(file: File): Promise<string> {
  const signResponse = await fetch(`${API_URL}/uploads/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "intake", fileName: file.name || "photo.jpg" }),
  });
  if (!signResponse.ok) throw await responseError(signResponse, "업로드 서명 발급에 실패했습니다.");
  const sign = await signResponse.json();

  if (sign.mode === "azure-sas") {
    const putResponse = await fetch(sign.uploadUrl, {
      method: sign.uploadMethod || "PUT",
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!putResponse.ok) throw new Error("사진 업로드에 실패했습니다.");
    return String(sign.blobUrl);
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "photo.jpg");
  const uploadResponse = await fetch(sign.uploadUrl, { method: sign.uploadMethod || "POST", body: formData });
  if (!uploadResponse.ok) throw await responseError(uploadResponse, "사진 업로드에 실패했습니다.");
  const uploaded = await uploadResponse.json();
  return String(uploaded.blobUrl);
}

async function handlePhotoSelected(file: File): Promise<void> {
  p2pState.regPhotoUploading = true;
  p2pState.regAiError = "";
  rerenderP2p();
  try {
    const blobUrl = await uploadCarrierPhoto(file);
    p2pState.regPhotoUrl = blobUrl;
    p2pState.regAiLoading = true;
    rerenderP2p();
    const response = await fetch(`${API_URL}/providers/carriers/ai-register/photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ photoUrl: blobUrl }),
    });
    if (!response.ok) throw await responseError(response, "AI 사진 분석에 실패했습니다.");
    const data = await response.json();
    applyDraft(data.draft || {});
  } catch (error) {
    p2pState.regAiError = error instanceof Error ? error.message : String(error);
  } finally {
    p2pState.regPhotoUploading = false;
    p2pState.regAiLoading = false;
    rerenderP2p();
  }
}

async function sendChatDraftMessage(): Promise<void> {
  const content = p2pState.chatDraftInput.trim();
  if (!content) return;
  p2pState.chatDraftMessages.push({ role: "user", content });
  p2pState.chatDraftInput = "";
  p2pState.chatDraftLoading = true;
  p2pState.chatDraftError = "";
  rerenderP2p();

  try {
    const response = await fetch(`${API_URL}/providers/carriers/ai-register/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ messages: p2pState.chatDraftMessages }),
    });
    if (!response.ok) throw await responseError(response, "챗봇 응답을 받지 못했습니다.");
    const data = await response.json();
    p2pState.chatDraftMessages.push({ role: "assistant", content: data.reply });
    applyDraft(data.draft || {});
  } catch (error) {
    p2pState.chatDraftError = error instanceof Error ? error.message : String(error);
  } finally {
    p2pState.chatDraftLoading = false;
    rerenderP2p();
  }
}

function useMyLocation(): void {
  if (!navigator.geolocation) {
    p2pState.regError = "이 브라우저는 위치 정보를 지원하지 않습니다.";
    rerenderP2p();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      // Rounded to ~3 decimals (~110m) to keep the stored point representative
      // rather than an exact address, per prd.md §19.5's privacy requirement.
      p2pState.regLatitude = Math.round(position.coords.latitude * 1000) / 1000;
      p2pState.regLongitude = Math.round(position.coords.longitude * 1000) / 1000;
      rerenderP2p();
    },
    (error) => {
      p2pState.regError = `위치 정보를 가져오지 못했습니다: ${error.message}`;
      rerenderP2p();
    },
  );
}

async function submitCarrierRegistration(): Promise<void> {
  if (!p2pState.regBrand.trim() || !p2pState.regModel.trim() || p2pState.regPrice <= 0) {
    p2pState.regError = "브랜드, 모델, 희망 가격을 모두 입력해주세요.";
    rerenderP2p();
    return;
  }

  p2pState.regSubmitting = true;
  p2pState.regError = "";
  p2pState.regNotice = "";
  rerenderP2p();

  try {
    const response = await fetch(`${API_URL}/providers/carriers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        size: p2pState.regSize,
        brandModel: `${p2pState.regBrand.trim()} ${p2pState.regModel.trim()}`,
        brand: p2pState.regBrand.trim(),
        model: p2pState.regModel.trim(),
        basePrice: p2pState.regPrice,
        intakePhotoUrl: p2pState.regPhotoUrl || undefined,
        dong: p2pState.regDong.trim() || undefined,
        latitude: p2pState.regLatitude,
        longitude: p2pState.regLongitude,
        dealMode: "direct",
        optInRentable: true,
      }),
    });
    if (!response.ok) throw await responseError(response, "캐리어 등록에 실패했습니다.");

    p2pState.regNotice = "캐리어가 등록되어 지도에 노출됩니다.";
    p2pState.regBrand = "";
    p2pState.regModel = "";
    p2pState.regPrice = 0;
    p2pState.regPhotoUrl = "";
    p2pState.regDong = "";
    p2pState.chatDraftMessages = [];
  } catch (error) {
    p2pState.regError = error instanceof Error ? error.message : String(error);
  } finally {
    p2pState.regSubmitting = false;
    rerenderP2p();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderAuthForm(contextNote?: string): string {
  const isSignup = p2pState.authMode === "signup";
  return `
    <div class="p2p-auth-card">
      ${contextNote ? `<p class="p2p-auth-note">${escapeHtml(contextNote)}</p>` : ""}
      <div class="p2p-reg-tabs" role="tablist">
        <button type="button" data-auth-mode="login" class="tab-pill ${!isSignup ? "is-active" : ""}">로그인</button>
        <button type="button" data-auth-mode="signup" class="tab-pill ${isSignup ? "is-active" : ""}">회원가입</button>
      </div>
      ${p2pState.authError ? `<div class="alert alert--error" role="alert"><span>!</span>${escapeHtml(p2pState.authError)}</div>` : ""}
      <form id="p2pAuthForm" class="field-stack">
        <label class="field">이메일<input id="p2pAuthEmail" type="email" autocomplete="email" value="${escapeHtml(p2pState.authEmail)}" placeholder="you@example.com" /></label>
        <label class="field">비밀번호<input id="p2pAuthPassword" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" value="${escapeHtml(p2pState.authPassword)}" placeholder="8자 이상" /></label>
        ${
          isSignup
            ? `
          <label class="field">이름<input id="p2pAuthName" value="${escapeHtml(p2pState.authName)}" placeholder="홍길동" /></label>
          <label class="field">전화번호 <small>(선택)</small><input id="p2pAuthPhone" value="${escapeHtml(p2pState.authPhone)}" placeholder="010-0000-0000" /></label>
        `
            : ""
        }
        <button type="submit" class="button button--primary" ${p2pState.authLoading ? "disabled" : ""}>${p2pState.authLoading ? "처리 중..." : isSignup ? "회원가입" : "로그인"}</button>
      </form>
    </div>
  `;
}

function renderMapCarrierList(): string {
  if (p2pState.mapLoading) {
    return '<div class="empty-state"><span class="empty-icon" aria-hidden="true">…</span><strong>불러오는 중...</strong></div>';
  }
  if (p2pState.mapCarriers.length === 0) {
    return '<div class="empty-state"><span class="empty-icon" aria-hidden="true">⌕</span><strong>아직 등록된 직거래 캐리어가 없어요.</strong><p>캐리어 등록 탭에서 첫 캐리어를 올려보세요.</p></div>';
  }
  return `
    <div class="p2p-carrier-grid">
      ${p2pState.mapCarriers
        .map(
          (carrier) => `
        <article class="p2p-carrier-card ${carrier.id === p2pState.selectedMapCarrierId ? "is-selected" : ""}">
          <div class="p2p-carrier-media"><img src="${escapeHtml(carrier.thumbnailUrl || "/luggage-placeholder.svg")}" alt="" /></div>
          <div class="p2p-carrier-body">
            <strong>${escapeHtml(carrierLabel(carrier))}</strong>
            <span>${sizeLabel(carrier.size)} · ${escapeHtml(carrier.dong || "동네 미등록")}</span>
            <span class="p2p-carrier-price">${currency(carrier.basePrice)}/일</span>
          </div>
          <button type="button" class="button button--primary button--small" data-request-carrier="${escapeHtml(carrier.id)}">요청 보내기</button>
        </article>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderRequestPanel(): string {
  const carrier = p2pState.mapCarriers.find((c) => c.id === p2pState.selectedMapCarrierId);
  if (!carrier) return "";

  if (!p2pState.user) {
    return `
      <section class="p2p-request-panel">
        <div class="section-head"><div><p class="eyebrow">요청 보내기</p><h2>${escapeHtml(carrierLabel(carrier))}</h2></div>
          <button type="button" class="button button--ghost button--small" data-close-request>닫기</button>
        </div>
        ${renderAuthForm("요청을 보내려면 먼저 로그인하거나 회원가입해주세요.")}
      </section>
    `;
  }

  return `
    <section class="p2p-request-panel">
      <div class="section-head">
        <div><p class="eyebrow">요청 보내기</p><h2>${escapeHtml(carrierLabel(carrier))}</h2></div>
        <button type="button" class="button button--ghost button--small" data-close-request>닫기</button>
      </div>
      <p class="field-hint">${sizeLabel(carrier.size)} · ${escapeHtml(carrier.dong || "동네 미등록")} · ${currency(carrier.basePrice)}/일</p>
      ${p2pState.requestError ? `<div class="alert alert--error" role="alert"><span>!</span>${escapeHtml(p2pState.requestError)}</div>` : ""}
      <form id="p2pRequestForm" class="field-stack">
        <div class="search-grid">
          <label class="field">시작일 <small>(선택)</small><input id="p2pRequestStart" type="date" value="${escapeHtml(p2pState.requestStartDate)}" /></label>
          <label class="field">종료일 <small>(선택)</small><input id="p2pRequestEnd" type="date" value="${escapeHtml(p2pState.requestEndDate)}" /></label>
        </div>
        <label class="field">메시지<textarea id="p2pRequestMessage" rows="3" placeholder="언제 어디서 만나서 전달받을 수 있을까요?">${escapeHtml(p2pState.requestMessage)}</textarea></label>
        <button type="submit" class="button button--primary" ${p2pState.requestSubmitting ? "disabled" : ""}>${p2pState.requestSubmitting ? "보내는 중..." : "요청 보내기"}</button>
      </form>
    </section>
  `;
}

function renderMapView(): string {
  return `
    <section class="p2p-panel">
      <div class="section-head">
        <div><p class="eyebrow">NEARBY</p><h2>동네에서 찾기</h2></div>
        <label class="sort-control">사이즈
          <select id="p2pMapSize">
            <option value="" ${p2pState.mapSize === "" ? "selected" : ""}>전체</option>
            <option value="carry_on" ${p2pState.mapSize === "carry_on" ? "selected" : ""}>기내용</option>
            <option value="medium" ${p2pState.mapSize === "medium" ? "selected" : ""}>중형</option>
          </select>
        </label>
      </div>
      ${
        KAKAO_MAP_KEY
          ? '<div id="p2pMapEl" class="p2p-map" role="img" aria-label="캐리어 위치 지도"></div>'
          : '<div class="empty-state"><span class="empty-icon" aria-hidden="true">🗺</span><strong>지도를 사용하려면 Kakao Map API 키가 필요합니다.</strong><p>아래 목록으로 확인할 수 있어요. (VITE_KAKAO_MAP_KEY 미설정)</p></div>'
      }
      ${renderMapCarrierList()}
      ${renderRequestPanel()}
    </section>
  `;
}

function renderPhotoRegister(): string {
  return `
    <label class="upload-field ${p2pState.regPhotoUploading || p2pState.regAiLoading ? "is-uploading" : ""}" for="p2pRegPhoto">
      <span class="upload-icon" aria-hidden="true">${p2pState.regPhotoUploading ? "↑" : p2pState.regAiLoading ? "AI" : "📷"}</span>
      <span>
        <strong>${p2pState.regPhotoUploading ? "업로드 중..." : p2pState.regAiLoading ? "AI가 사진을 분석 중..." : p2pState.regPhotoUrl ? "사진 업로드 완료" : "캐리어 사진 올리기"}</strong>
        <small>사진을 올리면 AI가 브랜드/모델/사이즈를 추정해 아래 폼에 자동으로 채워줘요. 결과는 자유롭게 수정할 수 있습니다.</small>
      </span>
      <input type="file" id="p2pRegPhoto" accept="image/*" ${p2pState.regPhotoUploading || p2pState.regAiLoading ? "disabled" : ""} />
    </label>
    ${p2pState.regAiError ? `<div class="alert alert--error" role="alert"><span>!</span>${escapeHtml(p2pState.regAiError)}</div>` : ""}
  `;
}

function renderChatBubble(message: ChatDraftMessage): string {
  return `<div class="p2p-chat-bubble ${message.role === "user" ? "is-mine" : "is-theirs"}">${escapeHtml(message.content)}</div>`;
}

function renderChatRegister(): string {
  return `
    <div class="p2p-chat-thread" id="p2pRegChatThread">
      ${
        p2pState.chatDraftMessages.length === 0
          ? '<p class="field-hint">캐리어에 대해 자유롭게 설명해보세요. 예: "삼성 캐리어 기내용인데 상태 괜찮아요"</p>'
          : p2pState.chatDraftMessages.map(renderChatBubble).join("")
      }
      ${p2pState.chatDraftLoading ? '<div class="p2p-chat-bubble is-theirs">…</div>' : ""}
    </div>
    ${p2pState.chatDraftError ? `<div class="alert alert--error" role="alert"><span>!</span>${escapeHtml(p2pState.chatDraftError)}</div>` : ""}
    <form id="p2pChatForm" class="p2p-chat-input-row">
      <input id="p2pChatInput" value="${escapeHtml(p2pState.chatDraftInput)}" placeholder="메시지를 입력하세요" ${p2pState.chatDraftLoading ? "disabled" : ""} />
      <button type="submit" class="button button--primary button--small" ${p2pState.chatDraftLoading ? "disabled" : ""}>보내기</button>
    </form>
  `;
}

function renderRegisterView(): string {
  if (!p2pState.user) return `<section class="p2p-panel">${renderAuthForm("캐리어를 등록하려면 로그인이 필요합니다.")}</section>`;

  const isChat = p2pState.regMode === "chat";
  return `
    <section class="p2p-panel">
      <div class="section-head"><div><p class="eyebrow">AI 등록</p><h2>캐리어 등록</h2></div></div>
      <div class="p2p-reg-tabs" role="tablist">
        <button type="button" data-reg-mode="manual" class="tab-pill ${!isChat ? "is-active" : ""}">사진으로 등록</button>
        <button type="button" data-reg-mode="chat" class="tab-pill ${isChat ? "is-active" : ""}">챗봇과 대화</button>
      </div>
      ${isChat ? renderChatRegister() : renderPhotoRegister()}

      <p class="section-kicker">등록 정보 확인 (AI 추정값을 자유롭게 수정하세요)</p>
      ${p2pState.regError ? `<div class="alert alert--error" role="alert"><span>!</span>${escapeHtml(p2pState.regError)}</div>` : ""}
      ${p2pState.regNotice ? `<div class="alert alert--success" role="status"><span>✓</span>${escapeHtml(p2pState.regNotice)}</div>` : ""}
      <form id="p2pRegForm" class="provider-form">
        <label class="field">사이즈
          <select id="p2pRegSize">
            <option value="carry_on" ${p2pState.regSize === "carry_on" ? "selected" : ""}>기내용</option>
            <option value="medium" ${p2pState.regSize === "medium" ? "selected" : ""}>중형</option>
          </select>
        </label>
        <label class="field">브랜드<input id="p2pRegBrand" value="${escapeHtml(p2pState.regBrand)}" placeholder="Samsonite" /></label>
        <label class="field">모델명<input id="p2pRegModel" value="${escapeHtml(p2pState.regModel)}" placeholder="C-Lite" /></label>
        <label class="field">희망 가격 (원/일)<input id="p2pRegPrice" type="number" min="1" value="${p2pState.regPrice || ""}" placeholder="10000" /></label>
        <label class="field">동네 (동 단위)<input id="p2pRegDong" value="${escapeHtml(p2pState.regDong)}" placeholder="역삼동" /></label>
        <button type="button" id="p2pUseLocation" class="button button--ghost button--small">${p2pState.regLatitude ? "위치 저장됨 · 다시 채우기" : "내 위치로 좌표 채우기"}</button>
        <button type="submit" class="button button--primary" ${p2pState.regSubmitting ? "disabled" : ""}>${p2pState.regSubmitting ? "등록 중..." : "등록하기"}</button>
      </form>
    </section>
  `;
}

function renderDealActionButtons(deal: DealRequestRecord): string {
  if (!p2pState.user) return "";
  const isOwner = deal.ownerId === p2pState.user.id;
  const disabled = p2pState.dealActionLoading ? "disabled" : "";
  if (deal.status === "requested") {
    return isOwner
      ? `<button type="button" class="button button--primary button--small" data-deal-status="accepted" ${disabled}>수락</button>
         <button type="button" class="button button--ghost button--small" data-deal-status="declined" ${disabled}>거절</button>`
      : `<button type="button" class="button button--ghost button--small" data-deal-status="cancelled" ${disabled}>요청 취소</button>`;
  }
  if (deal.status === "accepted") {
    return `${isOwner ? `<button type="button" class="button button--primary button--small" data-deal-status="completed" ${disabled}>완료 처리</button>` : ""}
            <button type="button" class="button button--ghost button--small" data-deal-status="cancelled" ${disabled}>취소</button>`;
  }
  return "";
}

function renderDealsList(): string {
  if (p2pState.dealsLoading) return '<div class="empty-state"><span class="empty-icon" aria-hidden="true">…</span><strong>불러오는 중...</strong></div>';
  if (p2pState.deals.length === 0) {
    return '<div class="empty-state"><span class="empty-icon" aria-hidden="true">💬</span><strong>아직 요청이 없습니다.</strong><p>지도에서 캐리어를 찾아 요청을 보내보세요.</p></div>';
  }
  return `
    <div class="p2p-deal-list">
      ${p2pState.deals
        .map(
          (deal) => `
        <button type="button" class="p2p-deal-item ${deal.id === p2pState.activeDealId ? "is-active" : ""}" data-open-deal="${escapeHtml(deal.id)}">
          <span class="badge">${DEAL_STATUS_LABEL[deal.status]}</span>
          <span>${p2pState.user && deal.ownerId === p2pState.user.id ? "받은 요청" : "내가 보낸 요청"}</span>
        </button>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderChatThread(): string {
  if (!p2pState.activeDeal) return "";
  const deal = p2pState.activeDeal;
  return `
    <section class="p2p-chat-panel">
      <div class="section-head">
        <div><span class="badge">${DEAL_STATUS_LABEL[deal.status]}</span></div>
        <div class="p2p-deal-actions">${renderDealActionButtons(deal)}</div>
      </div>
      <div class="p2p-chat-thread">
        ${
          p2pState.activeDealMessages.length === 0
            ? '<p class="field-hint">아직 메시지가 없습니다.</p>'
            : p2pState.activeDealMessages
                .map(
                  (message) =>
                    `<div class="p2p-chat-bubble ${p2pState.user && message.senderId === p2pState.user.id ? "is-mine" : "is-theirs"}">${escapeHtml(message.body)}</div>`,
                )
                .join("")
        }
      </div>
      ${deal.status === "declined" || deal.status === "cancelled" ? "" : `
        <form id="p2pDealMessageForm" class="p2p-chat-input-row">
          <input id="p2pDealMessageInput" value="${escapeHtml(p2pState.dealMessageInput)}" placeholder="메시지를 입력하세요" />
          <button type="submit" class="button button--primary button--small">보내기</button>
        </form>
      `}
    </section>
  `;
}

function renderRequestsView(): string {
  if (!p2pState.user) return `<section class="p2p-panel">${renderAuthForm("내 요청을 보려면 로그인이 필요합니다.")}</section>`;
  return `
    <section class="p2p-panel p2p-requests">
      <div class="section-head"><div><p class="eyebrow">MY DEALS</p><h2>내 요청</h2></div></div>
      ${p2pState.dealsError ? `<div class="alert alert--error" role="alert"><span>!</span>${escapeHtml(p2pState.dealsError)}</div>` : ""}
      ${renderDealsList()}
      ${renderChatThread()}
    </section>
  `;
}

export function renderP2pTab(): string {
  const user = p2pState.user;
  return `
    <section class="p2p-shell">
      <div class="p2p-intro">
        <p class="eyebrow">동네 직거래 (베타)</p>
        <h1>가까운 이웃과<br /><em>직접 주고받으세요.</em></h1>
        <p>지도에서 캐리어를 찾아 요청을 보내고, 채팅으로 만남을 조율하세요. 결제·배송·검수 없이 직접 거래합니다.</p>
      </div>
      <div class="p2p-status-bar">
        ${user ? `<span>${escapeHtml(user.name)}님 환영합니다</span><button type="button" class="button button--ghost button--small" id="p2pLogoutBtn">로그아웃</button>` : `<span>둘러보기는 로그인 없이 가능해요. 요청/등록은 로그인이 필요합니다.</span>`}
      </div>
      <nav class="p2p-subnav" aria-label="동네 직거래 메뉴">
        <button type="button" data-p2p-view="map" class="nav-btn ${p2pState.view === "map" ? "is-active" : ""}">지도</button>
        <button type="button" data-p2p-view="register" class="nav-btn ${p2pState.view === "register" ? "is-active" : ""}">캐리어 등록</button>
        <button type="button" data-p2p-view="requests" class="nav-btn ${p2pState.view === "requests" ? "is-active" : ""}">내 요청</button>
      </nav>
      ${p2pState.requestNotice ? `<div class="alert alert--success" role="status"><span>✓</span>${escapeHtml(p2pState.requestNotice)}</div>` : ""}
      ${p2pState.view === "map" ? renderMapView() : p2pState.view === "register" ? renderRegisterView() : renderRequestsView()}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks called from main.ts
// ---------------------------------------------------------------------------

/** Called once when the user switches into the 직거래 tab. */
export function initP2pTab(rerender: () => void): void {
  rerenderApp = rerender;
  const bootstrap = async () => {
    if (!p2pState.authResolved) await fetchMe();
    if (p2pState.view === "map") await fetchMapCarriers();
    if (p2pState.view === "requests" && p2pState.user) await fetchDeals();
    rerender();
  };
  void bootstrap();
}

/** Called when the user navigates away from the 직거래 tab. */
export function stopP2pTab(): void {
  stopChatPolling();
}

/** Must be called after renderP2pTab()'s HTML has been inserted into the DOM. */
export function bindP2pEvents(rerender: () => void): void {
  rerenderApp = rerender;
  if (!document.querySelector(".p2p-shell")) return; // not on the 직거래 tab this render

  void mountKakaoMapIfNeeded();

  document.querySelectorAll<HTMLButtonElement>("[data-p2p-view]").forEach((button) => {
    button.addEventListener("click", () => {
      p2pState.view = button.dataset.p2pView as P2pView;
      p2pState.requestNotice = "";
      if (p2pState.view === "map" && p2pState.mapCarriers.length === 0) void fetchMapCarriers();
      if (p2pState.view === "requests" && p2pState.user) void fetchDeals();
      rerenderP2p();
    });
  });

  document.getElementById("p2pLogoutBtn")?.addEventListener("click", () => logout());

  // Auth form (shared markup, may appear in map/register/requests views)
  document.querySelectorAll<HTMLButtonElement>("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      p2pState.authMode = button.dataset.authMode as "login" | "signup";
      p2pState.authError = "";
      rerenderP2p();
    });
  });
  document.getElementById("p2pAuthForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAuthForm();
  });
  document.getElementById("p2pAuthEmail")?.addEventListener("input", (event) => {
    p2pState.authEmail = (event.target as HTMLInputElement).value;
  });
  document.getElementById("p2pAuthPassword")?.addEventListener("input", (event) => {
    p2pState.authPassword = (event.target as HTMLInputElement).value;
  });
  document.getElementById("p2pAuthName")?.addEventListener("input", (event) => {
    p2pState.authName = (event.target as HTMLInputElement).value;
  });
  document.getElementById("p2pAuthPhone")?.addEventListener("input", (event) => {
    p2pState.authPhone = (event.target as HTMLInputElement).value;
  });

  // Map view
  document.getElementById("p2pMapSize")?.addEventListener("change", (event) => {
    p2pState.mapSize = (event.target as HTMLSelectElement).value as "" | Size;
    void fetchMapCarriers();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-request-carrier]").forEach((button) => {
    button.addEventListener("click", () => {
      p2pState.selectedMapCarrierId = button.dataset.requestCarrier || "";
      p2pState.requestError = "";
      rerenderP2p();
    });
  });
  document.querySelector<HTMLButtonElement>("[data-close-request]")?.addEventListener("click", () => {
    p2pState.selectedMapCarrierId = "";
    rerenderP2p();
  });
  document.getElementById("p2pRequestForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (p2pState.selectedMapCarrierId) void submitDealRequest(p2pState.selectedMapCarrierId);
  });
  document.getElementById("p2pRequestStart")?.addEventListener("input", (event) => {
    p2pState.requestStartDate = (event.target as HTMLInputElement).value;
  });
  document.getElementById("p2pRequestEnd")?.addEventListener("input", (event) => {
    p2pState.requestEndDate = (event.target as HTMLInputElement).value;
  });
  document.getElementById("p2pRequestMessage")?.addEventListener("input", (event) => {
    p2pState.requestMessage = (event.target as HTMLTextAreaElement).value;
  });

  // Register view
  document.querySelectorAll<HTMLButtonElement>("[data-reg-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      p2pState.regMode = button.dataset.regMode as "manual" | "chat";
      rerenderP2p();
    });
  });
  document.getElementById("p2pRegPhoto")?.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void handlePhotoSelected(file);
  });
  document.getElementById("p2pChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendChatDraftMessage();
  });
  document.getElementById("p2pChatInput")?.addEventListener("input", (event) => {
    p2pState.chatDraftInput = (event.target as HTMLInputElement).value;
  });
  document.getElementById("p2pRegForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCarrierRegistration();
  });
  document.getElementById("p2pRegSize")?.addEventListener("change", (event) => {
    p2pState.regSize = (event.target as HTMLSelectElement).value as Size;
  });
  document.getElementById("p2pRegBrand")?.addEventListener("input", (event) => {
    p2pState.regBrand = (event.target as HTMLInputElement).value;
  });
  document.getElementById("p2pRegModel")?.addEventListener("input", (event) => {
    p2pState.regModel = (event.target as HTMLInputElement).value;
  });
  document.getElementById("p2pRegPrice")?.addEventListener("input", (event) => {
    p2pState.regPrice = Number((event.target as HTMLInputElement).value) || 0;
  });
  document.getElementById("p2pRegDong")?.addEventListener("input", (event) => {
    p2pState.regDong = (event.target as HTMLInputElement).value;
  });
  document.getElementById("p2pUseLocation")?.addEventListener("click", () => useMyLocation());

  // Requests / chat view
  document.querySelectorAll<HTMLButtonElement>("[data-open-deal]").forEach((button) => {
    button.addEventListener("click", () => {
      const dealId = button.dataset.openDeal;
      if (dealId) void openDeal(dealId);
    });
  });
  document.getElementById("p2pDealMessageForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendDealMessage();
  });
  document.getElementById("p2pDealMessageInput")?.addEventListener("input", (event) => {
    p2pState.dealMessageInput = (event.target as HTMLInputElement).value;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-deal-status]").forEach((button) => {
    button.addEventListener("click", () => {
      const status = button.dataset.dealStatus as DealStatus;
      if (status) void updateActiveDealStatus(status);
    });
  });
}
