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
    // Real dismiss path: if the tutorial overlay was rendered by an async
    // auto-open, dismiss it via its close button. The overlay cannot
    // re-render during the click itself because a first page-level click
    // while the auto-open fetched is recorded and suppresses the remaining
    // in-flight auto-open, so the overlay is already gone (or never
    // rendered) by the time the caller clicks. No pauseAutoOpen needed.
    const closeBtn = this.tutorialCloseBtn;
    if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeBtn.click({ timeout: 3000 });
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
    await this.dismissTutorialIfVisible();
    const roomBtn = this.page.locator(`text=${roomName}`).first();
    await expect(roomBtn).toBeVisible({ timeout: 10_000 });
    // Dismiss again right before clicking: any async auto-open that fired
    // during the intervening gap is recorded via a first-page-level-click
    // capture listener and cannot re-render over the button or this click.
    await this.dismissTutorialIfVisible();
    await roomBtn.click();
  }

  async signOut(): Promise<void> {
    await this.btnLogout.click();
  }
}
