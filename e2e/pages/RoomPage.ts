import { Page, Locator, expect } from '@playwright/test';

export class RoomPage {
  readonly page: Page;
  readonly gameContainer: Locator;
  readonly canvas: Locator;
  readonly roomNav: Locator;
  readonly playerCard: Locator;
  readonly playerCardUsername: Locator;
  readonly chatPanel: Locator;
  readonly chatLog: Locator;
  readonly chatInput: Locator;
  readonly chatSendBtn: Locator;
  readonly btnPark: Locator;
  readonly btnMyLoft: Locator;
  readonly btnBrowseLofts: Locator;
  readonly btnAvatar: Locator;
  readonly btnSignOut: Locator;
  readonly avatarPanel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.gameContainer = page.locator('[data-testid="game-container"]');
    this.canvas = page.locator('[data-testid="haven-canvas"]');
    this.roomNav = page.locator('[data-testid="room-nav"]');
    this.playerCard = page.locator('[data-testid="player-card"]');
    this.playerCardUsername = page.locator('[data-testid="player-card-username"]');
    this.chatPanel = page.locator('[data-testid="chat-panel"]');
    this.chatLog = page.locator('[data-testid="chat-log"]');
    this.chatInput = page.locator('[data-testid="chat-input"]');
    this.chatSendBtn = page.locator('[data-testid="chat-send"]');
    this.btnPark = page.locator('[data-testid="btn-park"]');
    this.btnMyLoft = page.locator('[data-testid="btn-my-loft"]');
    this.btnBrowseLofts = page.locator('[data-testid="btn-browse-lofts"]');
    this.btnAvatar = page.locator('[data-testid="btn-avatar"]');
    this.btnSignOut = page.locator('[data-testid="btn-nav-logout"]');
    this.avatarPanel = page.locator('[data-testid="avatar-panel"]');
  }

  async waitForRoomReady(timeout = 20_000): Promise<void> {
    await expect(this.gameContainer).toBeVisible({ timeout });
    await expect(this.canvas).toBeVisible({ timeout });
    await this.page.waitForFunction(
      () => (window as any).__havenRoomReady === true || (window as any).__havenEngine !== undefined,
      { timeout }
    );
  }

  async clickCanvas(x = 200, y = 200): Promise<void> {
    await this.canvas.click({ position: { x, y } });
  }

  async sendChatMessage(message: string): Promise<void> {
    await expect(this.chatInput).toBeVisible();
    await this.chatInput.fill(message);
    await this.chatSendBtn.click();
  }

  async waitForChatMessage(expectedSubstr: string, timeout = 10_000): Promise<void> {
    await expect(this.chatLog).toContainText(expectedSubstr, { timeout });
  }

  async openAvatarCustomizer(): Promise<void> {
    await this.btnAvatar.click();
    await expect(this.avatarPanel).toBeVisible({ timeout: 5_000 });
  }

  async navigateToPark(): Promise<void> {
    await this.btnPark.click();
    await this.waitForRoomReady();
  }

  async navigateToLoft(): Promise<void> {
    await this.btnMyLoft.click();
    await this.waitForRoomReady();
  }

  async signOut(): Promise<void> {
    await this.btnSignOut.click();
    await expect(this.page.locator('[data-testid="login-panel"]')).toBeVisible({ timeout: 10_000 });
  }
}
