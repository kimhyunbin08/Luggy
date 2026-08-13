import { test, expect } from '@playwright/test';

test('normal booking/payment gate scenario placeholder', async ({ page }) => {
  await page.goto('data:text/html,<html><body><button id="cta">search</button></body></html>');
  await expect(page.locator('#cta')).toBeVisible();
});

test('cancel refund differential placeholder', async ({ page }) => {
  await page.goto('data:text/html,<html><body><div id="refund">48h 100% / 24h 50% / after 0%</div></body></html>');
  await expect(page.locator('#refund')).toContainText('50%');
});

test('delivery delay compensation placeholder', async ({ page }) => {
  await page.goto('data:text/html,<html><body><div id="delay">delivery delay shipping fee 100% refund</div></body></html>');
  await expect(page.locator('#delay')).toContainText('100% refund');
});
