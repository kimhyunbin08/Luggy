# Luggy Design System & Guidelines (v1.0)

## 1. 개요 (Overview)
Luggy C2C 지도 기반 이웃 캐리어 대여 플랫폼의 디자인 시스템 및 UI/UX 가이드라인이다.
Apple Human Interface Guidelines(HIG)의 명확성(Clarity), 가독성(Deference), 깊이감(Depth) 원칙과 당근마켓 스타일의 직관적인 C2C 오렌지 톤앤매너를 결합하여 구성한다.

---

## 2. 디자인 원칙 (Core Design Principles)

1. **Apple Human Interface Guidelines (HIG) 준수**
   - 시스템 폰트(-apple-system / SF Pro) 사용
   - 고해상도 그래스모피즘 및 백드롭 블러(`backdrop-filter: blur(20px)`)
   - 넉넉한 여백과 명확한 타이포그래피 위계

2. **C2C 직거래 최적화 (Carrot Market Style)**
   - 동네/위치 중심 지도(Map View) 최우선 배치
   - 지도 핀 및 오렌지 키 컬러 포인트로 직거래 액션 명확화
   - 복잡한 PG 결제 단계 없이 **소유자 1:1 대여 문의**로 빠른 직거래 연결

---

## 3. 컬러 시스템 (Color System)

| 구분 | 색상명 | Hex Code | 용도 |
| :--- | :--- | :--- | :--- |
| **Primary Accent** | Carrot Orange | `#FF6F0F` | 메인 CTA, 지도 핀, 가격 태그, 활성 탭 |
| **Primary Hover** | Orange Hover | `#E55E00` | 버튼 호버 상태 |
| **Brand Identity** | Luggy Navy | `#0B3A82` | 로고 서브 강조, 메인 뱃지 |
| **Success** | SF Green | `#12805C` | 예약 완료, 검수 성공, 가용 상태 |
| **Alert/Scarcity** | SF Red | `#D9381E` | 긴급 알림, 마감 임박 태그 |
| **Background Primary**| System Gray BG| `#F5F5F7` | 메인 앱 라이트 배경 |
| **Background Surface**| Card White | `#FFFFFF` | 카드, 모달, 서치바 컴포넌트 |
| **Text Primary** | SF Black | `#1D1D1F` | 주요 제목 및 메인 본문 |
| **Text Secondary** | SF Gray | `#86868B` | 보조 설명, 라벨, 이웃 아이디 |
| **Border Color** | System Border | `rgba(0, 0, 0, 0.08)` | 카드 및 입력창 분리선 |

---

## 4. 타이포그래피 (Typography)

- **Font Family:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif`
- **Headings:**
  - H1 (Header Title): 22px / Bold (800) / `-0.5px` Letter Spacing
  - H2 (Section Title): 20px / Bold (700) / `-0.4px` Letter Spacing
  - H3 (Card Title): 16px / Bold (700) / `-0.3px` Letter Spacing
- **Body & Controls:**
  - Body Normal: 14px / Regular (400) or Medium (500)
  - Small / Badge: 12px / SemiBold (600)
  - Price Tag: 14px~18px / Heavy (800)

---

## 5. UI 컴포넌트 규격 (UI Component Specs)

### 5.1 헤더 (Navigation Bar)
- Sticky Top / `background: rgba(255, 255, 255, 0.88)` / `backdrop-filter: blur(20px)`
- 로고: Luggy (Carrot Orange `#FF6F0F`, Bold 800) + HIG 뱃지

### 5.2 지도 뷰 (Map View)
- OpenStreetMap (기본 Leaflet) + **카카오 지도 SDK (Kakao Maps Web SDK) 듀얼 연동**
- 지도 핀 클릭 시 팝업 카드 및 `1:1 대여 문의` 즉시 연결
- 마커 및 지적도 라운딩: `border-radius: 18px`

### 5.3 C2C 매물 카드 (Carrier Product Card)
- 320px+ 가변 그리드 레이아웃
- 상단 이미지 (190px 높이) + 좌상단 동네 뱃지(📍 역삼동) + 우하단 일일 가격 태그(7,900원/일)
- 하단: 소유자 닉네임, 평점, 직거래 희망 위치 설명, `💬 1:1 대여 문의하기` 버튼

### 5.4 1:1 대여 문의 모달 (Contact Modal)
- 반투명 블러 오버레이 (`background: rgba(0, 0, 0, 0.5)`)
- 대여자 정보(이름, 연락처, 일정, 메시지) 입력 후 소유자 직접 연락처 제공

---

## 6. 카카오 지도 API 연동 가이드 (Kakao Maps SDK Integration)

- **웹 연동 스크립트:**
  ```html
  <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=YOUR_KAKAO_APP_KEY&autoload=false"></script>
  ```
- **초기화 메소드:**
  `loadKakaoMapSdk('YOUR_KAKAO_APP_KEY')` 호출 시 기존 Leaflet 지도에서 카카오 지도(`kakao.maps.Map`) 및 커스텀 마커로 자동 교체 동작.
