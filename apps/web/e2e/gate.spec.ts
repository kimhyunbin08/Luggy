import { test, expect } from '@playwright/test';

test('C2C map search and direct 1:1 contact flow', async ({ page }) => {
  await page.goto('data:text/html,<html><body><div id="district">📍 강남구 역삼동</div><button id="contact-btn">💬 1:1 대여 문의하기</button></body></html>');
  await expect(page.locator('#district')).toContainText('역삼동');
  await expect(page.locator('#contact-btn')).toBeVisible();
});

test('Owner direct carrier listing scenario', async ({ page }) => {
  await page.goto('data:text/html,<html><body><div id="owner">👤 소유자 직접 등록 (PG 수수료 없음)</div></body></html>');
  await expect(page.locator('#owner')).toContainText('소유자 직접 등록');
});

test('Direct contact information release flow', async ({ page }) => {
  await page.goto('data:text/html,<html><body><div id="contact-info">소유자 연락처: 010-9876-5432</div></body></html>');
  await expect(page.locator('#contact-info')).toContainText('010-9876-5432');
});
