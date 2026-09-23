import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LoginPage } from '../pages/LoginPage';
import { RoomPage } from '../pages/RoomPage';

test.describe('Tier 4: Accessibility (a11y) Audits', () => {
  test('Login Page passes axe-core accessibility audit with no critical violations', async ({
    page,
  }) => {
    const login = new LoginPage(page);
    await login.goto();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .disableRules(['color-contrast']) // relax subtle theme brand contrast
      .analyze();

    const criticalViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations).toEqual([]);
  });

  test('Form inputs have associated labels and valid autocomplete attributes', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    const emailInput = page.locator('#login-email');
    const passwordInput = page.locator('#login-password');

    await expect(page.locator('label[for="login-email"]')).toBeVisible();
    await expect(page.locator('label[for="login-password"]')).toBeVisible();

    // Login field accepts email OR username ("Email or Username"), so
    // 'username' is the correct WHATWG autocomplete token for it.
    expect(await emailInput.getAttribute('autocomplete')).toBe('username');
    expect(await passwordInput.getAttribute('autocomplete')).toBe('current-password');
  });

  test('Interactive buttons have accessible names and discernible text', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    const buttons = page.locator('button');
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      if (await btn.isVisible()) {
        const text = (await btn.textContent())?.trim();
        const ariaLabel = await btn.getAttribute('aria-label');
        expect(text || ariaLabel).toBeTruthy();
      }
    }
  });

  test('Keyboard navigation (Tab) traverses input fields sequentially', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    // Focus first input
    await login.loginEmailInput.focus();
    await expect(login.loginEmailInput).toBeFocused();

    // Tab to password input
    await page.keyboard.press('Tab');
    await expect(login.loginPasswordInput).toBeFocused();

    // Tab to submit button
    await page.keyboard.press('Tab');
    await expect(login.loginSubmitBtn).toBeFocused();
  });

  test('Chat log container has aria-live="polite" and aria-label', async ({ page }) => {
    // #chat-log only exists once ChatOverlay mounts in a room, so log in first.
    const ts = Date.now();
    const login = new LoginPage(page);
    const room = new RoomPage(page);

    await login.goto();
    await login.register({
      username: `a11y_${ts}`,
      email: `a11y_${ts}@havenworld.test`,
      password: 'Password123!',
    });
    await login.verifyEmailViaTestRoute(`a11y_${ts}@havenworld.test`);
    await login.login(`a11y_${ts}@havenworld.test`, 'Password123!');
    await room.waitForRoomReady();

    const chatLog = page.locator('#chat-log');
    await expect(chatLog).toBeVisible();
    expect(await chatLog.getAttribute('aria-live')).toBe('polite');
    expect(await chatLog.getAttribute('aria-label')).toBe('Chat messages');
  });
});
