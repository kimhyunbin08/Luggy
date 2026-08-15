# Luggy MVP - 배포 및 실행 가이드

## 개요

Luggy는 캐리어 렌탈 플랫폼 MVP입니다.

**MVP 범위:**
- ✅ Provider 러개지 입고/등록/사진 업로드
- ✅ Renter 검색/예약/결제 (3단계 체크아웃)
- ✅ 배송 상태 동기화
- ✅ 검수 사진 업로드
- ✅ 정산 자동 계산 (80% Platform / 20% Provider)
- ✅ 퍼널 이벤트 로깅

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
# Web: http://localhost:3000
# PostgreSQL: localhost:5432 (postgres:postgres)

# 3. 브라우저에서 http://localhost:3000 열기
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

## Azure 배포 (다음 주)

### 사전 요구사항

```bash
# Azure CLI 설치
brew install azure-cli

# Azure 로그인
az login

# 리소스 그룹 생성
az group create --name luggy-rg --location koreacentral

# Container Registry 생성
az acr create --resource-group luggy-rg --name luggyacr --sku Basic
```

### GitHub Actions 시크릿 설정

`.github/workflows/deploy.yml` 실행을 위해 GitHub 저장소 Settings → Secrets에 추가:

```
AZURE_CREDENTIALS: <Azure Service Principal JSON>
STAGING_DATABASE_URL: postgresql://user:pass@host:5432/luggy-staging
PROD_DATABASE_URL: postgresql://user:pass@host:5432/luggy-prod
REGISTRY_USERNAME: <Container Registry username>
REGISTRY_PASSWORD: <Container Registry password>
```

### 배포 트리거

```bash
# Staging 배포 (docs/specs-azure-mvp 브랜치에 push)
git push origin docs/specs-azure-mvp

# Production 배포 (main 브랜치에 push)
git push origin main
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
```

---

## E2E 테스트 (Playwright)

```bash
# 테스트 실행 (API & Web이 실행 중이어야 함)
cd apps/web
npm install -D @playwright/test
npx playwright test e2e/gate.spec.ts

# UI 모드 (대화식)
npx playwright test --ui
```

### 테스트 케이스

1. **E2E 1**: Provider 등록 → Renter 검색 → 예약 생성
2. **E2E 2**: 예약 취소 및 환불 계산
3. **E2E 3**: 배송 상태 webhook → 예약 상태 전이
4. **E2E 4**: 검수 사진 업로드 → 예약 완료 → 정산 계산
5. **E2E 5**: 퍼널 이벤트 로깅 및 메트릭

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
lsof -i :3000
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

---

## 문의 & 지원

GitHub Issues에서 버그 및 기능 요청을 받습니다.
