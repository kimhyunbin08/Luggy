# Luggy MVP - 배포 및 실행 가이드

## 개요

Luggy는 캐리어 렌탈 플랫폼 MVP입니다.

**MVP 범위:**
- ✅ Provider 러개지 입고/등록/사진 업로드 (Azure Blob 또는 로컬 저장소에 실제 업로드)
- ✅ Renter 검색/예약/결제 (3단계 체크아웃) + 체크아웃 내 예약 취소(차등 환불)
- ✅ 배송 상태 동기화 (서명된 웹훅) 및 배송 지연 보상 원장 기록
- ✅ 검수 사진 업로드 및 손상 클레임 생성/처리
- ✅ 정산 자동 계산 (80% Platform / 20% Provider)
- ✅ 퍼널 이벤트 로깅 및 KPI 대시보드
- ✅ **운영(Ops) 콘솔**: 예약 조회, 취소, 배송 이벤트 시뮬레이션, 검수 등록, 클레임 처리,
  예약 완료, KPI 대시보드를 모두 브라우저에서 조작 가능
- ⛔ 실제 PG(결제대행사) 연동은 MVP 범위에서 제외 (의도적 정책, mock 결제 provider가
  실제 서명된 웹훅 경로를 그대로 통과)

---

## 로컬 개발 (Docker Compose)

### 준비

```bash
# 1. 저장소 클론
git clone https://github.com/kimhyunbin08/Luggy.git
cd Luggy

# 2. Docker & Docker Compose 설치 확인
docker --version
docker-compose --version
```

### 실행

```bash
# 1. 모든 서비스 시작 (PostgreSQL + API + Web)
docker-compose up --build

# 2. 서비스 확인
# API: http://localhost:3001
# Web: http://localhost:3002
# PostgreSQL: localhost:5432 (postgres:postgres)

# 3. 브라우저에서 http://localhost:3002 열기
#    상단 네비게이션의 "운영" 탭이 예약 조회/취소/배송 시뮬레이션/검수/클레임/완료/KPI를
#    모두 다루는 운영 콘솔입니다.
```

### Docker 없이 로컬 실행 (선택)

```bash
# 1. PostgreSQL만 Docker로 띄우고 API/Web은 네이티브로 실행하고 싶을 때
docker-compose up -d postgres

# 2. API (실제 Postgres 기반 서버, tsx로 TS 직접 실행)
npm run dev:api   # apps/api: tsx src/server.ts, http://localhost:3001

# 3. Web (Vite dev server)
npm run dev:web   # apps/web: vite dev, http://localhost:5173
```

### 중지

```bash
docker-compose down
```

### 데이터베이스 초기화

```bash
# 스키마 자동 생성됨 (docker-entrypoint-initdb.d에서)
# 정책 버전 초기화:
docker-compose exec api npm run db:init
```

---

## Azure 배포 (azd CLI)

Azure 배포는 [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/)로
관리합니다. `azure.yaml` + `infra/*.bicep`가 Container Apps 기반 인프라를 선언하고, `azd up` 한 번으로
프로비저닝(리소스 생성)과 배포(이미지 빌드/푸시/롤아웃)를 함께 수행합니다. `koreacentral` 리전에
`staging`, `production` 두 환경이 리소스그룹(`rg-staging`, `rg-production`)으로 완전히 분리되어 있습니다.

> `.github/workflows/deploy.yml`(GitHub Actions + `az containerapp up`)은 azd 도입 이전 방식으로,
> 현재는 이 azd 플로우로 대체되었습니다. 정리 여부는 별도 논의 필요.

### 인프라 구성 (`infra/`)

| 리소스 | 용도 |
|---|---|
| Resource Group (`rg-<env>`) | 환경별 완전 격리 |
| Container Apps 환경 + Log Analytics | api/web 컨테이너 앱 호스팅, 로그 수집 |
| Container Registry (Basic, admin 비활성화) | Docker 이미지 저장, 공유 Managed Identity로 `AcrPull` |
| PostgreSQL Flexible Server (Burstable B1ms, v16) | 애플리케이션 DB (`luggyadmin`/`luggy`) |
| Storage Account + Blob Container (`intake-photos`, `inspection-photos`) | 검수/입고 사진 저장 (공개 읽기, 앱은 쓰기 전용 SAS만 발급) |
| Container App `ca-api-*` | Express API (env: `DATABASE_URL`, 웹훅 시크릿 등 secret로 주입) |
| Container App `ca-web-*` | Vite 정적 번들 서빙 (`VITE_API_URL`을 빌드 시점에 API FQDN으로 주입) |

> Service Bus / Key Vault / VNet·Private Endpoint·WAF / Static Web Apps는 `trd.md` v0.2의 목표
> 아키텍처이지만, 현재 구현(Express + Vite, 큐 미사용)에 맞춰 **의도적으로 보류**했습니다.
> Post-MVP 항목으로 아래 "다음 단계"에 명시.

### 사전 요구사항

```bash
brew install azure-cli azd
az login
azd auth login   # 최초 1회, 브라우저 인증
```

### 환경 생성 및 시크릿 설정

`staging`, `production`은 서로 다른 Postgres 비밀번호/웹훅 시크릿을 사용해야 합니다. 값은 로컬
`.azure/<env>/.env`에만 저장되고, azd가 만든 `.azure/.gitignore`(`*`)로 git에 커밋되지 않습니다.

```bash
azd env new staging --location koreacentral
azd env set POSTGRES_ADMIN_PASSWORD "<3종 이상 문자 조합, 8자+>"
azd env set PAYMENT_WEBHOOK_SECRET "$(openssl rand -hex 32)"
azd env set DELIVERY_WEBHOOK_SECRET "$(openssl rand -hex 32)"

azd env new production --location koreacentral
azd env set POSTGRES_ADMIN_PASSWORD "<staging과 다른 값>" --environment production
azd env set PAYMENT_WEBHOOK_SECRET "$(openssl rand -hex 32)" --environment production
azd env set DELIVERY_WEBHOOK_SECRET "$(openssl rand -hex 32)" --environment production
```

### 배포

```bash
azd up -e staging       # 프로비저닝 + 이미지 빌드/푸시 + 배포
azd up -e production
```

완료되면 `ca-api-*` / `ca-web-*`의 공개 FQDN이 콘솔에 출력됩니다 (`azd env get-values`로도 확인 가능).

### 최초 배포 후 DB 스키마 적용 & 시드

Bicep은 Postgres 서버/DB만 생성하고 스키마는 자동 적용하지 않습니다 (런타임 이미지에 `psql` 없음,
`schema.sql`은 이미지 안에 포함됨). **최초 배포 시 한 번**, 로컬에 이미 빌드된 `luggy-api` 이미지로
원격 DB에 적용합니다:

```bash
# 1) 내 IP를 임시로 Postgres 방화벽에 허용
MY_IP=$(curl -s https://api.ipify.org)
PG_NAME=pg-xxxxxxxxxxxxx   # azd 출력 또는 `az postgres flexible-server list -g rg-<env>`
az postgres flexible-server firewall-rule create -g rg-<env> -n "$PG_NAME" \
  --rule-name AllowMyIpTemp --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"

# 2) DATABASE_URL 조립 (비밀번호는 `azd env get-value POSTGRES_ADMIN_PASSWORD -e <env>`)
DB_URL="postgresql://luggyadmin:<password>@${PG_NAME}.postgres.database.azure.com:5432/luggy?sslmode=require"

# 3) 스키마 적용
docker run --rm -e DATABASE_URL="$DB_URL" luggy-api node -e "
  const fs=require('fs');const {Client}=require('pg');
  const c=new Client({connectionString:process.env.DATABASE_URL});
  c.connect().then(()=>c.query(fs.readFileSync('/app/schema.sql','utf8')))
   .then(()=>{console.log('OK');return c.end();});
"

# 4) 기본 정책 버전(v1.0) 시드
docker run --rm -e DATABASE_URL="$DB_URL" luggy-api node dist/scripts/init-db.js

# 5) 임시 방화벽 규칙 제거 (필수 — 열어둔 채로 두지 말 것)
az postgres flexible-server firewall-rule delete -g rg-<env> -n "$PG_NAME" \
  --rule-name AllowMyIpTemp --yes
```

### 재배포 (코드만 변경 시)

```bash
azd deploy -e staging      # 인프라 변경 없이 이미지 재빌드/재배포
azd deploy -e production
```

인프라(Bicep)를 바꾼 경우 `azd provision`(또는 `azd up`)을 다시 실행합니다.

### 환경 삭제

```bash
azd down -e staging --purge
azd down -e production --purge
```

---

## API 엔드포인트 (MVP 핵심)

### Provider 플로우

```bash
# 1. 캐리어 등록 (사진 포함)
POST /providers/carriers
{
  "providerId": "uuid",
  "size": "carry_on",
  "brandModel": "Samsonite C-Lite",
  "basePrice": 120000,
  "intakePhotoUrl": "https://..."
}

# 2. 렌탈 허용 전환
POST /providers/carriers/{id}/opt-in

# 3. 내 캐리어 조회
GET /providers/{providerId}/carriers
```

### Renter 플로우

```bash
# 1. 검색 (기간 + 사이즈)
GET /renters/search?size=carry_on&start_date=2026-08-20&end_date=2026-08-22

# 2. 예약 생성
POST /bookings
{
  "renterId": "uuid",
  "carrierId": "uuid",
  "startDate": "2026-08-20",
  "endDate": "2026-08-22"
}

# 3. 결제 승인
POST /bookings/{id}/authorize-payment

# 4. 예약 조회
GET /bookings/{id}

# 5. 예약 취소 (환불 정책 자동 적용)
POST /bookings/{id}/cancel

# 6. 예약 완료
POST /bookings/{id}/complete
```

### 배송 & 검수

```bash
# 배송 상태 업데이트 (자동 상태 전이)
POST /webhooks/delivery
{
  "bookingId": "uuid",
  "direction": "outbound|return",
  "status": "in_transit|arrived|delayed"
}

# 검수 사진 업로드
POST /inspections
{
  "bookingId": "uuid",
  "inspectionType": "intake|outbound|return",
  "photos": ["https://...", "https://..."]
}
```

사진은 먼저 `POST /uploads/sign`으로 업로드 대상을 발급합니다.
`AZURE_STORAGE_CONNECTION_STRING`이 설정된 환경에서는 15분짜리 쓰기 전용 Azure Blob SAS URL을
반환하고, 로컬 환경에서는 `POST /uploads/local/{token}`에 multipart `file`을 전송하는
디스크 fallback을 사용합니다. 반환된 `blobUrl`을 Provider 입고 또는 Inspection 사진 URL로
저장합니다.

배송과 결제 웹훅은 원문 JSON body에 대한 HMAC 서명이 필요합니다.

```text
POST /webhooks/payments
X-Payment-Signature: t=<unix_timestamp>,v1=<sha256_hmac>

POST /webhooks/delivery
X-Delivery-Signature: t=<unix_timestamp>,v1=<sha256_hmac>
```

MVP의 결제 승인 경로는 외부 PG 대신 서명된 mock provider 이벤트를 사용하지만, 외부 이벤트와
동일한 서명 검증 및 idempotency ledger 경로를 통과합니다. 운영 환경에서는
`PAYMENT_WEBHOOK_SECRET`과 `DELIVERY_WEBHOOK_SECRET`을 반드시 별도 강한 값으로 설정합니다.

### 퍼널 & 메트릭

```bash
# 이벤트 로깅
POST /funnel/events
{
  "eventType": "landing_view|search_submit|result_view|detail_view|checkout_step1|checkout_step2|checkout_step3|paid",
  "metadata": {}
}

# 퍼널 메트릭 조회
GET /metrics/funnel

# KPI 대시보드 집계
GET /metrics/kpi
```

---

## E2E 테스트 (Playwright)

```bash
# 준비: API & Web이 Docker Compose로 실행 중이어야 함 (docker-compose up -d)
cd apps/web
npx playwright install --with-deps chromium   # 최초 1회, 브라우저 바이너리 설치
npm run e2e                                   # == npx playwright test

# UI 모드 (대화식)
npx playwright test --ui
```

### 테스트 케이스 (AGENTS.md 필수 3개 게이트)

1. **Gate 1 - 정상 예약/결제**: Provider 등록(실제 사진 업로드) → opt-in → Renter 검색/선택/
   예약 → 결제 승인. 예약이 `confirmed` 상태로 영속화되고 `charge` 원장 항목이 생성됨을
   서버 조회로 재확인.
2. **Gate 2 - 취소 환불 차등**: 픽업 48시간 이상 전에 취소 → 전액 환불, 픽업 24~48시간 전에
   취소 → 50% 환불. 동일 정책이 시점에 따라 실제로 다른 금액을 반환함을 검증.
3. **Gate 3 - 배송 지연 보상 반영**: 운영 콘솔에서 출고 배송을 지연 처리하면 보상 원장
   항목이 예약 상세(원장 테이블)에 즉시 반영되고, 서버에도 서명된 웹훅 경로를 통해
   영속화됨을 검증.

각 게이트는 실제 Docker Compose 스택(Postgres + API + Web)에 대해 실제 브라우저 UI를
조작하여 실행됩니다 (API를 우회하지 않음).

---

## 기술 스택

| 계층 | 기술 | 버전 |
|-----|------|------|
| **Frontend** | TypeScript + Vite | 4.3+ |
| **Backend** | Node.js + Express | 5.2.1 |
| **Validation** | Zod | 4.4.3 |
| **Database** | PostgreSQL | 16 |
| **Deployment** | Docker + Azure Container Apps | - |
| **CI/CD** | GitHub Actions | - |
| **Testing** | Playwright | 1.40+ |

---

## 설정 값 (정책)

```typescript
{
  minRentalDays: 2,
  dailyPrice: {
    carry_on: 7900,
    medium: 11900
  },
  deposit: {
    carry_on: 30000,
    medium: 50000
  },
  roundTripShipping: 14000,
  refund: {
    fullHours: 48,      // 100% 환불
    halfHours: 24       // 50% 환불
  },
  platformFeePercent: 80  // Platform 80% / Provider 20%
}
```

## 런타임 환경 변수

| 변수 | 용도 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `PORT` | API 서버 포트 (기본 3001) |
| `NODE_ENV` | 실행 환경 (`development`/`production`/`test`) |
| `PUBLIC_API_URL` | 로컬 업로드 fallback의 공개 URL |
| `LOCAL_UPLOAD_DIR` | 로컬 업로드 fallback이 파일을 저장할 디스크 경로 (기본: OS temp) |
| `PLATFORM_LOGISTICS_COST_RATIO` | 공헌이익 계산 시 배송비 중 플랫폼 부담 비율 (기본 0.7) |
| `WEB_ORIGIN` / `WEB_ORIGINS` | Web CORS 허용 origin |
| `PAYMENT_WEBHOOK_SECRET` | 결제 웹훅 HMAC 비밀키 (운영 환경에서는 반드시 강한 값으로 별도 설정) |
| `DELIVERY_WEBHOOK_SECRET` | 배송 웹훅 HMAC 비밀키 (운영 환경에서는 반드시 강한 값으로 별도 설정) |
| `AZURE_STORAGE_CONNECTION_STRING` | 설정 시 Azure Blob SAS 업로드 활성화 (미설정 시 로컬 디스크 fallback) |
| `AZURE_BLOB_CONTAINER_INTAKE` / `AZURE_BLOB_CONTAINER_INSPECTION` | Blob 컨테이너명 override |
| `VITE_API_URL` (web 빌드 시점) | 정적 번들에 인라인되는 API base URL |

---

## 문제 해결

### PostgreSQL 연결 오류
```bash
# 컨테이너 상태 확인
docker-compose ps

# 로그 확인
docker-compose logs postgres

# 강제 재시작
docker-compose restart postgres
```

### 포트 충돌
```bash
# 포트 사용 확인
lsof -i :3001
lsof -i :3002
lsof -i :5432

# docker-compose.yml의 포트 변경
```

### API 응답 오류
```bash
# API 로그 확인
docker-compose logs api

# 헬스 체크
curl http://localhost:3001/health
```

---

## 다음 단계 (Post-MVP)

- [ ] 실거래 20건 공헌이익 게이트 자동 판정
- [ ] 연체/분실/추가청구 자동화
- [ ] 다중 창고 라우팅
- [ ] 멤버십/구독 모델
- [ ] 동적 가격 자동화
- [ ] 모바일 앱 (React Native)
- [ ] Service Bus 기반 비동기 처리 (`trd.md` v0.2 목표, 현재는 동기 Express 라우트로 구현)
- [ ] Key Vault 연동 (현재 시크릿은 Container Apps secret + azd 환경변수로 관리)
- [ ] VNet / Private Endpoint / WAF 적용 (현재 Postgres·ACR·Storage는 공개 엔드포인트 기반)
- [ ] Static Web Apps로 프론트엔드 이전 (현재는 Container Apps에서 정적 번들 서빙)

---

## 문의 & 지원

GitHub Issues에서 버그 및 기능 요청을 받습니다.
