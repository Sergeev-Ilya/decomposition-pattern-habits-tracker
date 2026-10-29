import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export async function loginAsTestUser(page: Page, email: string, password: string) {
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password); await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Мои привычки/ })).toBeVisible();
}
type Account = { email: string; password: string; api: APIRequestContext; createHabit: (name?: string) => Promise<any> };
export const test = base.extend<{ account: Account; browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = []; const failedResponses = new Set<string>();
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('response', response => { if (response.status() >= 400) failedResponses.add(response.url()); });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // Chromium logs expected HTTP 401/404 resource failures; still assert every JS/application error.
      const url = message.location().url;
      if (/^Failed to load resource: the server responded with a status of (401|404)\b/.test(message.text()) && (failedResponses.has(url) || /\/api\//.test(url))) return;
      errors.push(`console: ${message.text()}`);
    });
    try { await use(errors); } finally { await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } }); }
    expect(errors).toEqual([]);
  }, { auto: true }],
  account: async ({ playwright, baseURL }, use) => {
    const email = `e2e-${randomUUID()}@example.test`; const password = `Qа-${randomUUID()}`;
    const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
    expect((await api.post('/api/auth/register', { data: { email, password, timeZone: 'Europe/Moscow' } })).status()).toBe(201);
    expect((await api.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
    const createHabit = async (name = `E2E ${randomUUID()}`) => { const response = await api.post('/api/habits', { data: { name, description: 'Синтетическая привычка E2E' } }); expect(response.status()).toBe(201); return response.json(); };
    try { await use({ email, password, api, createHabit }); }
    finally {
      // Only this fixture's unique account is inspected/cleaned, exclusively via public API.
      await api.post('/api/auth/login', { data: { email, password } });
      const response = await api.get('/api/habits');
      if (response.ok()) for (const habit of (await response.json()).habits) expect((await api.delete(`/api/habits/${habit.id}`)).status()).toBe(204);
      expect((await api.post('/api/auth/logout')).status()).toBe(204); await api.dispose();
    }
  },
});
export { expect };
