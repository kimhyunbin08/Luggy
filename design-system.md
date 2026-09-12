# Luggy Web MVP Design System

## Direction

Luggy uses a calm, tactile palette for a trustworthy OTA rental funnel. The interface keeps
the search action above the fold, makes total price and availability visible early, and uses
native semantic controls with explicit focus, disabled, and error states.

## Color tokens

| Token | Hex | Usage |
| --- | --- | --- |
| Terracotta Clay | `#B5543A` | Primary CTA, active emphasis, action focus |
| Olive Accent | `#6F7F5F` | Verified, available, and completed states |
| Soft Limestone | `#F0E6D8` | Page canvas, quiet surfaces, warm contrast |
| Deep Rust | `#5A2E25` | Headings, high-priority text, selected borders |
| Ink | `#101719` | Body text and maximum contrast |
| Limestone Mist | `#F8F4EE` | Cards and raised surfaces |
| Rust Line | `#D7B4A8` | Borders and dividers |

The four colors in the attached reference image are the brand source of truth. Ink and
Limestone Mist are supporting accessibility/surface tokens, not additional brand accents.

## Spacing and shape

- Base spacing unit: `4px`; common layout rhythm: `8 / 12 / 16 / 20 / 24 / 32px`.
- Control height: `46px`; minimum interactive target: `44px`.
- Card radius: `16px`; hero radius: `24px`; controls: `10px`.
- Content width: `min(1240px, 92vw)`.
- Desktop checkout uses a two-column grid with a sticky order summary.

## Components

### Search form

The first viewport contains start date, return date, size, receiving address, and one
Terracotta Clay `즉시 조회` CTA. Date validation and the two-day minimum are surfaced inline.

### Result card

Every result card follows the same order:

1. Thumbnail and size.
2. Brand/model plus rating and review count.
3. Inspection badge and remaining quantity.
4. ETA and total price for the selected date range.
5. Reference price shown with a strike-through only as a comparison anchor.

Cards are keyboard activatable, use a selected border instead of a decorative glow, and
keep the price block aligned at the bottom.

### Checkout

Checkout is fixed to three steps: `상품 선택 -> 정보 입력 -> 결제`. The active step uses
Deep Rust text and a pale limestone surface; completed steps use Olive Accent. The order
summary repeats the same total shown in the result card and exposes the shipping line item.

### Provider intake

Provider registration keeps the same field labels, control height, CTA treatment, and
success/error states as renter checkout. The opt-in checkbox is explicit and the carrier
list exposes intake status and rental availability.

## Responsive breakpoints and chopped-risk controls

| Breakpoint | Behavior |
| --- | --- |
| `> 1024px` | Five-column search form, result list + sticky checkout summary |
| `641-1024px` | Two-column search form, checkout moves below results |
| `<= 640px` | Single-column form, stacked cards, full-width CTA, compact top bar |

At `640px`, no card content is allowed to overflow horizontally. At `1024px`, the checkout
panel must not squeeze the result cards below a readable width.

## Reference decisions

- shadcn/ui: variant-oriented component states and token ownership.
- Radix: semantic controls, keyboard activation, visible focus, and explicit disabled/invalid
  states. The repository remains framework-free instead of importing React primitives.
- Stripe Checkout: persistent step indicator, order summary, transparent total, and trust
  copy near the payment action.
- Airbnb: date-aware availability, total price visibility on result cards, and scarcity copy
  that supports a decision without hiding the price.
