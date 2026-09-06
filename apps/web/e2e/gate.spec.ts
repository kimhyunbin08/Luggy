import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Required MVP E2E gates (AGENTS.md §8):
 *   1. 정상 예약/결제           - normal booking + payment authorization
 *   2. 취소 환불 차등           - tiered cancellation refund (differs by timing)
 *   3. 배송 지연 보상 반영     - delivery-delay compensation reflected end-to-end
 *
 * Every gate drives the real browser UI against the actual Docker-composed stack
 * (web + api + postgres) - no API bypass of the user-facing flow. Payment is the
 * intentionally-mocked in-house payment service (see AGENTS.md scope); everything
 * else (booking, ledger, webhooks, uploads, ops actions) hits real backend code.
 */

const API_URL = process.env.API_URL || 'http://localhost:3001';
const WEB_URL = process.env.WEB_URL || 'http://localhost:3002';
const PHOTO_PATH = path.join(__dirname, 'fixtures', 'test-photo.png');

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function futureDateStr(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function parseWon(text: string | null): number {
  return parseInt((text || '').replace(/[^\d]/g, ''), 10) || 0;
}

/** Registers a fresh opt-in carrier via the real Provider UI, including a genuinely
 * uploaded intake photo (exercises the storage sign -> upload -> blobUrl pipeline). */
async function registerCarrier(
  page: Page,
  opts: { brand: string; model: string; price: number; city?: string },
): Promise<void> {
  await page.goto(WEB_URL);
  await page.locator('[data-tab="provider"]').click();
  await page.fill('#providerBrand', opts.brand);
  await page.fill('#providerModel', opts.model);
  await page.fill('#providerPrice', String(opts.price));
  if (opts.city) await page.fill('#providerCity', opts.city);
  await page.setInputFiles('#providerPhoto', PHOTO_PATH);
  await expect(page.locator('.upload-field strong')).toHaveText('입고 사진 업로드 완료', { timeout: 15000 });
  await page.locator('#registerBtn').click();
  await expect(page.locator('.alert--success')).toBeVisible({ timeout: 10000 });
}

/** Runs the real renter funnel (search -> select -> details -> create booking) through the
 * UI and leaves the page on checkout step 3 with an unpaid booking. Returns the booking id
 * and the exact total price shown in the order summary, so callers can assert against it. */
async function searchAndCreateBooking(
  page: Page,
  opts: { customerName: string; customerPhone: string; startDate?: string; endDate?: string },
): Promise<{ bookingId: string; totalPrice: number }> {
  await page.locator('[data-tab="rent"]').click();
  if (opts.startDate) await page.fill('#startDate', opts.startDate);
  if (opts.endDate) await page.fill('#endDate', opts.endDate);
  await page.locator('#searchBtn').click();
  await page.waitForSelector('.cards .carrier-card', { timeout: 10000 });
  await page.locator('.cards .carrier-card').first().click();
  const totalPrice = parseWon(await page.locator('.summary-total strong').first().textContent());
  await page.locator('#toStep2').click();
  await page.fill('#customerName', opts.customerName);
  await page.fill('#customerPhone', opts.customerPhone);
  await page.locator('#toStep3').click();
  await expect(page.locator('.success-box')).toBeVisible({ timeout: 10000 });
  const bookingIdText = await page.locator('.success-box b').first().textContent();
  return { bookingId: (bookingIdText || '').trim(), totalPrice };
}

test.describe('Luggy MVP required E2E gates', () => {
  test('Gate 1: 정상 예약/결제 흐름이 끝까지 동작한다', async ({ page, request }) => {
    const suffix = uniqueSuffix();
    await registerCarrier(page, { brand: 'GateOne', model: `Model-${suffix}`, price: 90000 });

    const { bookingId } = await searchAndCreateBooking(page, {
      customerName: 'Gate One Tester',
      customerPhone: '01011110000',
    });
    expect(bookingId.length).toBeGreaterThan(10);

    await page.locator('#payAuthorize').click();
    await expect(page.locator('.success-box')).toContainText('결제 승인 완료', { timeout: 10000 });
    await expect(page.locator('#cancelBookingBtn')).toBeVisible();

    // Confirm the UI action produced a real, durable backend state change (not just a
    // client-side optimistic flag): the booking is persisted with a charge ledger entry.
    const bookingRes = await request.get(`${API_URL}/bookings/${bookingId}`);
    expect(bookingRes.ok()).toBeTruthy();
    const booking = await bookingRes.json();
    expect(booking.status).toBe('confirmed');
    expect(booking.ledgerEntries.some((entry: { entryType: string }) => entry.entryType === 'charge')).toBe(
      true,
    );
  });

  test('Gate 2: 취소 시 환불 정책이 시점에 따라 차등 적용된다', async ({ page }) => {
    const suffix = uniqueSuffix();
    await registerCarrier(page, { brand: 'GateTwo', model: `Model-${suffix}`, price: 100000 });

    // Sub-case A: pickup is far away (default search dates, 7~9 days out) -> >=48h before
    // pickup -> full (100%) refund.
    const bookingA = await searchAndCreateBooking(page, {
      customerName: 'Gate Two Full Refund',
      customerPhone: '01022220000',
    });
    await page.locator('#payAuthorize').click();
    await expect(page.locator('#cancelBookingBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#cancelBookingBtn').click();
    await expect(page.locator('.alert--success')).toContainText('취소', { timeout: 10000 });
    const refundA = parseWon(await page.locator('.alert--success').textContent());
    expect(refundA).toBe(bookingA.totalPrice);

    // Sub-case B: pickup is only 2~4 days away -> lands in the 24~48h window -> half (50%)
    // refund. Same carrier, same policy - only the timing differs.
    const bookingB = await searchAndCreateBooking(page, {
      customerName: 'Gate Two Half Refund',
      customerPhone: '01022220001',
      startDate: futureDateStr(2),
      endDate: futureDateStr(4),
    });
    await page.locator('#payAuthorize').click();
    await expect(page.locator('#cancelBookingBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#cancelBookingBtn').click();
    await expect(page.locator('.alert--success')).toContainText('취소', { timeout: 10000 });
    const refundB = parseWon(await page.locator('.alert--success').textContent());
    expect(refundB).toBe(Math.floor(bookingB.totalPrice * 0.5));

    // The two cancellations against the identical policy produced genuinely different
    // refund amounts - proving the tiered policy is actually applied, not a flat rate.
    expect(refundA).toBeGreaterThan(refundB);
  });

  test('Gate 3: 배송 지연 보상이 예약/원장에 반영된다', async ({ page, request }) => {
    const suffix = uniqueSuffix();
    await registerCarrier(page, { brand: 'GateThree', model: `Model-${suffix}`, price: 95000 });

    const { bookingId } = await searchAndCreateBooking(page, {
      customerName: 'Gate Three Tester',
      customerPhone: '01033330000',
    });
    await page.locator('#payAuthorize').click();
    await expect(page.locator('.success-box')).toContainText('결제 승인 완료', { timeout: 10000 });

    // Ops console should auto-load this exact booking (no manual id re-entry needed).
    await page.locator('[data-tab="ops"]').click();
    await expect(page.locator('#opsBookingIdInput')).toHaveValue(bookingId, { timeout: 10000 });
    await expect(page.locator('.ops-booking-detail')).toBeVisible({ timeout: 10000 });

    await page.selectOption('#opsDeliveryDirection', 'outbound');
    await page.selectOption('#opsDeliveryStatus', 'in_transit');
    await page.locator('#opsSimulateDeliveryBtn').click();
    await expect(page.locator('.alert--success')).toContainText('배송 상태가 갱신', { timeout: 10000 });

    await page.selectOption('#opsDeliveryStatus', 'delayed');
    await page.locator('#opsSimulateDeliveryBtn').click();
    await expect(page.locator('.alert--success')).toContainText('지연', { timeout: 10000 });

    // The delay-compensation ledger entry (환불) must appear in the booking's ledger table.
    await expect(page.locator('.ledger-table')).toContainText('환불', { timeout: 10000 });

    // And it must be durably persisted server-side via the real signed webhook path,
    // not just an optimistic client-only notice.
    const bookingRes = await request.get(`${API_URL}/bookings/${bookingId}`);
    expect(bookingRes.ok()).toBeTruthy();
    const booking = await bookingRes.json();
    expect(booking.deliveryStatus).toBe('delayed');
    expect(booking.ledgerEntries.some((entry: { entryType: string }) => entry.entryType === 'refund')).toBe(
      true,
    );
  });

  test('Gate 4: 도시 선택이 실제로 렌탈 검색 결과를 필터링한다', async ({ page }) => {
    const suffix = uniqueSuffix();
    const brandBusan = `CityGateBusan-${suffix}`;
    const brandSeoul = `CityGateSeoul-${suffix}`;
    await registerCarrier(page, { brand: brandBusan, model: `Model-${suffix}`, price: 77000, city: '부산' });
    await registerCarrier(page, { brand: brandSeoul, model: `Model-${suffix}`, price: 78000, city: '서울' });

    await page.locator('[data-tab="rent"]').click();
    // The rent tab refetches the available-cities list on every visit, so the city we
    // just registered under must show up as a real, data-backed option (not a hardcoded one).
    await expect(page.locator('#searchCity option', { hasText: '부산' })).toHaveCount(1, { timeout: 10000 });

    await page.selectOption('#searchCity', '부산');
    await page.locator('#searchBtn').click();
    await page.waitForSelector('.cards .carrier-card', { timeout: 10000 });
    await expect(page.locator('.cards')).toContainText(brandBusan);
    await expect(page.locator('.cards')).not.toContainText(brandSeoul);

    // Selecting a different city must genuinely swap which carrier is excluded, proving the
    // backend applies a real filter rather than the dropdown being cosmetic.
    await page.selectOption('#searchCity', '서울');
    await page.locator('#searchBtn').click();
    await page.waitForSelector('.cards .carrier-card', { timeout: 10000 });
    await expect(page.locator('.cards')).toContainText(brandSeoul);
    await expect(page.locator('.cards')).not.toContainText(brandBusan);
  });
});
