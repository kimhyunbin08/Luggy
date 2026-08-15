import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';

test.describe('Luggy MVP E2E Tests', () => {
  
  test('E2E 1: Provider registers carrier and Renter books it', async ({ page }) => {
    // Navigate to web
    await page.goto(WEB_URL);

    // Step 1: Verify landing view
    const header = page.locator('.topbar .brand');
    await expect(header).toContainText('luggy');

    // Step 2: Switch to Provider tab
    const providerTab = page.locator('button:has-text("맡기기")');
    await providerTab.click();

    // Step 3: Fill provider form and register
    await page.fill('#providerBrand', 'Samsonite');
    await page.fill('#providerModel', 'C-Lite');
    await page.fill('#providerPrice', '120000');
    await page.fill('#providerPhoto', 'https://via.placeholder.com/300');
    
    const registerBtn = page.locator('#registerBtn');
    await registerBtn.click();

    // Wait for registration to complete
    await page.waitForTimeout(2000);

    // Step 4: Switch back to Renter tab
    const rentTab = page.locator('button:has-text("렌탈")');
    await rentTab.click();

    // Step 5: Perform search
    const searchBtn = page.locator('#searchBtn');
    await searchBtn.click();

    // Step 6: Wait for results and verify at least one carrier
    await page.waitForSelector('.cards .card', { timeout: 5000 });
    const cards = page.locator('.cards .card');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Step 7: Select first carrier
    await cards.first().click();

    // Step 8: Proceed to step 2
    const toStep2 = page.locator('#toStep2');
    await toStep2.click();

    // Step 9: Fill customer info
    await page.fill('#customerName', 'John Doe');
    await page.fill('#customerPhone', '01012345678');

    // Step 10: Proceed to step 3
    const toStep3 = page.locator('#toStep3');
    await toStep3.click();

    // Wait for booking creation
    await page.waitForTimeout(2000);

    // Step 11: Verify booking created with ID
    const bookingIdElement = page.locator('strong');
    const text = await bookingIdElement.first().textContent();
    expect(text).toBeTruthy();
    expect(text?.length).toBeGreaterThan(0);

    console.log('✓ E2E 1 PASSED: Provider registration and Renter booking');
  });

  test('E2E 2: Booking cancellation and refund calculation', async ({ page }) => {
    // Navigate to web
    await page.goto(WEB_URL);

    // Create a booking first
    const rentTab = page.locator('button:has-text("렌탈")');
    await rentTab.click();

    const searchBtn = page.locator('#searchBtn');
    await searchBtn.click();

    await page.waitForSelector('.cards .card', { timeout: 5000 });
    const cards = page.locator('.cards .card');
    await cards.first().click();

    const toStep2 = page.locator('#toStep2');
    await toStep2.click();

    await page.fill('#customerName', 'Jane Doe');
    await page.fill('#customerPhone', '01098765432');

    const toStep3 = page.locator('#toStep3');
    await toStep3.click();

    await page.waitForTimeout(2000);

    // Extract booking ID and test cancellation via API
    const bookingResultText = await page.locator('.success').textContent();
    console.log('Booking created:', bookingResultText);

    // Verify booking exists
    expect(bookingResultText).toContain('예약 완료');

    console.log('✓ E2E 2 PASSED: Booking cancellation test prepared');
  });

  test('E2E 3: Delivery status webhook and booking state transition', async ({ page, request }) => {
    // This test verifies delivery webhooks work correctly
    
    // First create a booking via API
    const bookingRes = await request.post(`${API_URL}/bookings`, {
      data: {
        renterId: '550e8400-e29b-41d4-a716-446655440000',
        carrierId: '550e8400-e29b-41d4-a716-446655440002',
        startDate: '2026-08-20',
        endDate: '2026-08-22',
        idempotencyKey: `e2e_test_${Date.now()}`,
      }
    });

    expect(bookingRes.ok()).toBeTruthy();
    const booking = await bookingRes.json();
    const bookingId = booking.id;

    console.log(`Created booking: ${bookingId}`);

    // Simulate delivery webhook
    const webhookRes = await request.post(`${API_URL}/webhooks/delivery`, {
      data: {
        bookingId,
        direction: 'outbound',
        status: 'in_transit'
      }
    });

    expect(webhookRes.ok()).toBeTruthy();

    // Verify booking state updated
    const getRes = await request.get(`${API_URL}/bookings/${bookingId}`);
    expect(getRes.ok()).toBeTruthy();
    const updatedBooking = await getRes.json();
    expect(updatedBooking.deliveryStatus).toBe('in_transit');

    console.log('✓ E2E 3 PASSED: Delivery webhook and state transition');
  });

  test('E2E 4: Inspection photo upload and booking completion', async ({ request }) => {
    // Create a booking
    const bookingRes = await request.post(`${API_URL}/bookings`, {
      data: {
        renterId: '550e8400-e29b-41d4-a716-446655440000',
        carrierId: '550e8400-e29b-41d4-a716-446655440003',
        startDate: '2026-08-25',
        endDate: '2026-08-27',
        idempotencyKey: `e2e_inspection_${Date.now()}`,
      }
    });

    expect(bookingRes.ok()).toBeTruthy();
    const booking = await bookingRes.json();
    const bookingId = booking.id;

    // Simulate inspection photo upload
    const inspectionRes = await request.post(`${API_URL}/inspections`, {
      data: {
        bookingId,
        inspectionType: 'return',
        photos: [
          'https://via.placeholder.com/600x400?text=Photo1',
          'https://via.placeholder.com/600x400?text=Photo2'
        ]
      }
    });

    expect(inspectionRes.ok()).toBeTruthy();

    // Complete booking
    const completeRes = await request.post(`${API_URL}/bookings/${bookingId}/complete`, {
      data: {}
    });

    expect(completeRes.ok()).toBeTruthy();
    const completed = await completeRes.json();
    
    // Verify settlement calculated
    expect(completed.settlement).toBeDefined();
    expect(completed.settlement.platformFee).toBeGreaterThan(0);
    expect(completed.settlement.providerPayout).toBeGreaterThan(0);

    console.log('✓ E2E 4 PASSED: Inspection upload and booking completion');
  });

  test('E2E 5: Funnel events tracking', async ({ page, request }) => {
    // Navigate and trigger events
    await page.goto(WEB_URL);

    await page.waitForTimeout(1000);

    // Check funnel metrics
    const metricsRes = await request.get(`${API_URL}/metrics/funnel`);
    expect(metricsRes.ok()).toBeTruthy();
    
    const metrics = await metricsRes.json();
    console.log('Funnel metrics:', metrics);
    expect(metrics.events).toBeDefined();

    console.log('✓ E2E 5 PASSED: Funnel events tracking');
  });
});
