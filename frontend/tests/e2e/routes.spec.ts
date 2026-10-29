import { test, expect, loginAsTestUser } from './fixtures/auth';
import { randomUUID } from 'node:crypto';

test('guest login/register routes, form validation and real UI registration/login/logout', async ({ page }) => {
  const email = `ui-${randomUUID()}@example.test`, password = `UI-${randomUUID()}`;
  await page.goto('/'); await expect(page).toHaveURL(/\/login$/); await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
  await page.getByRole('link', { name: 'Зарегистрироваться' }).click(); await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: 'Начните свой ритм' })).toBeVisible();
  await expect(page.getByText(/Восстановление пароля в этой версии недоступно/)).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Пароль', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click(); await expect(page.getByRole('alert')).toContainText('от 8 до 128');
  await page.getByLabel('Пароль', { exact: true }).fill(password); await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/\/login$/); await expect(page.getByRole('status')).toContainText('Аккаунт создан');
  await loginAsTestUser(page, email, password); await expect(page.getByRole('heading', { name: 'Пока нет привычек' })).toBeVisible();
  await page.goto('/login'); await expect(page).toHaveURL(/\/$/); await page.goto('/register'); await expect(page).toHaveURL(/\/$/);
  const cookies = await page.context().cookies(); expect(cookies.some(c => c.httpOnly)).toBe(true);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.getByRole('button', { name: 'Выйти', exact: true }).filter({ visible: true }).click(); await expect(page).toHaveURL(/\/login$/);
});

test('home and habit calendar: UI create/mark/undo/edit/cancel/delete and refresh persistence', async ({ page, account }) => {
  await loginAsTestUser(page, account.email, account.password);
  await page.getByRole('button', { name: 'Добавить привычку', exact: true }).first().click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.getByLabel('Название привычки').fill('Читать E2E'); await dialog.getByLabel(/Описание/).fill('До сна'); await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(page.getByRole('link', { name: 'Читать E2E', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отметить сегодня: Читать E2E', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Отменить отметку за сегодня: Читать E2E', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.getByRole('button', { name: 'Отменить отметку за сегодня: Читать E2E', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Читать E2E', exact: true }).click(); await expect(page).toHaveURL(/\/habits\/[^/]+$/);
  const habitUrl = page.url(), id = new URL(habitUrl).pathname.split('/').pop(); const response = await account.api.get(`/api/habits/${id}/calendar`); expect(response.status()).toBe(200); const calendar = await response.json();
  const [year, month] = calendar.today.split('-').map(Number); const fullDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  expect(calendar.daysInMonth).toBe(fullDays); expect(calendar.completedCount).toBe(1); expect(calendar.completionPercent).toBeCloseTo(100 / fullDays, 12);
  await expect(page.getByRole('heading', { name: 'Читать E2E', exact: true })).toBeVisible();
  await expect(page.getByText(`Выполнено 1 из ${calendar.daysInMonth} дней`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${(100 / fullDays).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, { exact: true })).toBeVisible();
  const today = page.getByRole('button', { name: /, сегодня\./ }); await expect(today).toHaveAttribute('aria-pressed', 'true'); await expect(today).toBeEnabled();
  await today.click(); await expect(today).toHaveAttribute('aria-pressed', 'false'); await expect(page.getByText(`Выполнено 0 из ${calendar.daysInMonth} дней`, { exact: true })).toBeVisible();
  await expect(today).toBeEnabled(); await today.click(); await expect(today).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.getByRole('button', { name: /, сегодня\./ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Предыдущий месяц' })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
  const future = page.getByRole('button', { name: /Будущая дата/ }); for (const button of await future.all()) await expect(button).toBeDisabled();
  const beforeCreation = page.getByRole('button', { name: /Привычка ещё не была создана/ }); for (const button of await beforeCreation.all()) await expect(button).toBeDisabled();
  expect(await today.count() + await future.count() + await beforeCreation.count()).toBe(calendar.daysInMonth);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click(); await dialog.getByLabel('Название привычки').fill('Читать обновлено'); await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Читать обновлено', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: /, сегодня\./ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Удалить привычку', exact: true }).click(); await expect(dialog.getByText(/вся история будут удалены без возможности восстановления/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused(); await dialog.getByRole('button', { name: 'Отмена', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Читать обновлено', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить привычку', exact: true }).click(); await dialog.getByRole('button', { name: 'Удалить привычку', exact: true }).click();
  await expect(page).toHaveURL(/\/$/); await expect(page.getByRole('heading', { name: 'Пока нет привычек' })).toBeVisible(); expect((await account.api.get(`/api/habits/${id}`)).status()).toBe(404);
  await page.getByRole('button', { name: 'Выйти', exact: true }).filter({ visible: true }).click();
});

test('normalizes malformed and out-of-range months; safe habit/month return after logout', async ({ page, account }) => {
  const { habit, today } = await account.createHabit(); const month = today.slice(0, 7); const path = `/habits/${habit.id}?month=${month}`;
  await page.goto(path); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email', { exact: true }).fill(account.email); await page.getByLabel('Пароль', { exact: true }).fill(account.password); await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`\\/habits\\/${habit.id}\\?month=${month}$`)); await expect(page.getByRole('heading', { name: habit.name, exact: true })).toBeVisible();
  for (const invalid of ['bad', '0000-01', '2026-13', '1900-01', '9999-12']) { await page.goto(`/habits/${habit.id}?month=${invalid}`); await expect(page).toHaveURL(new RegExp(`month=${month}$`)); await expect(page.getByRole('heading', { name: habit.name, exact: true })).toBeVisible(); }
  await page.getByRole('button', { name: 'Выйти', exact: true }).filter({ visible: true }).click(); await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: habit.name, exact: true })).toBeHidden();
  await page.getByLabel('Email', { exact: true }).fill(account.email); await page.getByLabel('Пароль', { exact: true }).fill(account.password); await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`\\/habits\\/${habit.id}\\?month=${month}$`)); await expect(page.getByRole('heading', { name: habit.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).filter({ visible: true }).click();
});

test('unknown route and unknown/private habit reveal no owner data', async ({ page, account }) => {
  await page.goto('/missing-route'); await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible(); await expect(page.getByRole('link', { name: 'Войти', exact: true })).toBeVisible();
  await loginAsTestUser(page, account.email, account.password);
  await page.goto(`/habits/${randomUUID()}`); await expect(page.getByRole('heading', { name: 'Привычка не найдена' })).toBeVisible();
  await page.goto('/missing-route'); await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible(); await page.getByRole('link', { name: 'Мои привычки', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Мои привычки/ })).toBeVisible(); await page.getByRole('button', { name: 'Выйти', exact: true }).filter({ visible: true }).click();
});

test('real session revocation clears visible private content and rejects saved cookie on reload', async ({ page, account }) => {
  const { habit, today } = await account.createHabit('Приватная запись'); await loginAsTestUser(page, account.email, account.password);
  await page.getByRole('link', { name: habit.name, exact: true }).click(); await expect(page.getByRole('heading', { name: habit.name, exact: true })).toBeVisible();
  // Same browser session is revoked by public logout API, not a mocked response or edited cookie.
  const saved = await page.context().cookies(); expect((await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } })).status()).toBe(204);
  await page.context().addCookies(saved);
  await page.getByRole('button', { name: /, сегодня\./ }).click(); await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('alert')).toContainText('Сессия истекла'); await expect(page.getByText(habit.name, { exact: true })).toBeHidden();
  await page.reload(); await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible(); await expect(page.getByText(habit.name, { exact: true })).toBeHidden();
});

test('390px layout and keyboard dialog focus trap, Escape, cancel without saving', async ({ page, account }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await loginAsTestUser(page, account.email, account.password);
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await noOverflow(); const open = page.getByRole('button', { name: 'Добавить привычку', exact: true }).first(); await open.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); await noOverflow();
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); }
  await dialog.getByLabel('Название привычки').fill('Не сохранять'); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(open).toBeFocused(); await expect(page.getByText('Не сохранять', { exact: true })).toBeHidden();
  const { habit } = await account.createHabit('Мобильный календарь'); await page.reload(); await page.getByRole('link', { name: habit.name, exact: true }).click(); await expect(page.getByRole('heading', { name: habit.name, exact: true })).toBeVisible(); await noOverflow();
  await page.getByRole('button', { name: 'Выйти', exact: true }).filter({ visible: true }).click(); await noOverflow();
});
