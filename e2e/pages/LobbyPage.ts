import { Page, Locator, expect } from '@playwright/test';

export class LobbyPage {
  readonly page: Page;
  readonly lobbyPanel: Locator;
  readonly roomGrid: Locator;
  readonly tabPublic: Locator;
  readonly tabLofts: Locator;
  readonly btnCloseLobby: Locator;
  readonly btnLogout: Locator;
  readonly tutorialOverlay: Locator;
  readonly tutorialCloseBtn: Locator;
  readonly tutorialLaterBtn: Locator;
  readonly tutorialDoneBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.lobbyPanel = page.locator('[data-testid="lobby-panel"]');
    this.roomGrid = page.locator('[data-testid="room-grid"]');
    this.tabPublic = page.locator('[data-testid="tab-rooms-public"]');
    this.tabLofts = page.locator('[data-testid="tab-rooms-lofts"]');
    this.btnCloseLobby = page.locator('[data-testid="btn-close-lobby"]');
    this.btnLogout = page.locator('[data-testid="btn-lobby-logout"]');
    this.tutorialOverlay = page.locator('#tutorial-overlay');
    this.tutorialCloseBtn = page.locator('#tutorial-overlay [data-action="close"]');
    this.tutorialLaterBtn = page.locator('#tutorial-overlay [data-action="later"]');
    this.tutorialDoneBtn = page.locator('#tutorial-overlay [data-action="done"]');
  }

  async waitForLoaded(): Promise<void> {
    await expect(this.lobbyPanel).toBeVisible({ timeout: 15_000 });
  }

  async dismissTutorialIfVisible(): Promise<void> {
    if (await this.tutorialOverlay.isVisible().catch(() => false)) {
      await this.tutorialCloseBtn.click();
      await expect(this.tutorialOverlay).toBeHidden();
    }
  }

  async selectPublicTab(): Promise<void> {
    await this.dismissTutorialIfVisible();
    await this.tabPublic.click();
    await expect(this.tabPublic).toHaveClass(/tab--active/);
  }

  async selectLoftsTab(): Promise<void> {
    await this.dismissTutorialIfVisible();
    await this.tabLofts.click();
    await expect(this.tabLofts).toHaveClass(/tab--active/);
  }

  async enterRoom(roomName: string): Promise<void> {
    const roomBtn = this.page.locator(`text=${roomName}`).first();
    await expect(roomBtn).toBeVisible({ timeout: 10_000 });
    await roomBtn.click();
  }

  async signOut(): Promise<void> {
    await this.btnLogout.click();
  }
}
