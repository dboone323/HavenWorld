import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly loginPanel: Locator;
  readonly tabLogin: Locator;
  readonly tabRegister: Locator;
  readonly loginEmailInput: Locator;
  readonly loginPasswordInput: Locator;
  readonly loginSubmitBtn: Locator;
  readonly regUsernameInput: Locator;
  readonly regEmailInput: Locator;
  readonly regPasswordInput: Locator;
  readonly regConfirmInput: Locator;
  readonly regInviteInput: Locator;
  readonly regSubmitBtn: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.loginPanel = page.locator('[data-testid="login-panel"]');
    this.tabLogin = page.locator('[data-testid="tab-login"]');
    this.tabRegister = page.locator('[data-testid="tab-register"]');
    this.loginEmailInput = page.locator('[data-testid="login-email"]');
    this.loginPasswordInput = page.locator('[data-testid="login-password"]');
    this.loginSubmitBtn = page.locator('[data-testid="login-submit"]');
    this.regUsernameInput = page.locator('[data-testid="reg-username"]');
    this.regEmailInput = page.locator('[data-testid="reg-email"]');
    this.regPasswordInput = page.locator('[data-testid="reg-password"]');
    this.regConfirmInput = page.locator('[data-testid="reg-confirm"]');
    this.regInviteInput = page.locator('[data-testid="reg-invite"]');
    this.regSubmitBtn = page.locator('[data-testid="reg-submit"]');
    this.errorMessage = page.locator('[data-testid="login-error"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.loginPanel).toBeVisible({ timeout: 15_000 });
  }

  async switchToRegister(): Promise<void> {
    await this.tabRegister.click();
    await expect(this.regUsernameInput).toBeVisible();
  }

  async switchToLogin(): Promise<void> {
    await this.tabLogin.click();
    await expect(this.loginEmailInput).toBeVisible();
  }

  async register(params: {
    username: string;
    email: string;
    password: string;
    confirm?: string;
    inviteCode?: string;
  }): Promise<void> {
    await this.switchToRegister();
    await this.regUsernameInput.fill(params.username);
    await this.regEmailInput.fill(params.email);
    await this.regPasswordInput.fill(params.password);
    await this.regConfirmInput.fill(params.confirm ?? params.password);
    if (params.inviteCode) {
      await this.regInviteInput.fill(params.inviteCode);
    }
    await this.regSubmitBtn.click();
  }

  async login(email: string, password: string): Promise<void> {
    await this.switchToLogin();
    await this.loginEmailInput.fill(email);
    await this.loginPasswordInput.fill(password);
    await this.loginSubmitBtn.click();
  }

  async verifyEmailViaTestRoute(email: string): Promise<void> {
    const serverUrl = process.env.VITE_SERVER_URL || 'http://localhost:3000';
    const res = await this.page.request.post(`${serverUrl}/api/test/verify-email`, {
      data: { email },
    });
    expect(res.ok()).toBe(true);
  }

  async getErrorMessage(): Promise<string> {
    return (await this.errorMessage.textContent()) ?? '';
  }
}
