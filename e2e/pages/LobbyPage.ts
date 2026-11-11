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
    // The tutorial overlay auto-opens asynchronously after app init (~1.5s +
    // an async /api/tutorial/status fetch) and can render between any check
    // and the next click, intercepting pointer events. Force-remove it from
    // the DOM right before the caller's click so there is no window for it to
    // appear and intercept. Once removed it won't re-appear this session
    // (autoShown flag). The tutorial is not what this suite asserts on.
    await this.page.evaluate(() => {
      const el = document.getElementById('tutorial-overlay');
      if (el) el.remove();
    });
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
    // Dismiss again right before clicking: the tutorial overlay auto-opens
    // asynchronously (~1.5s after app init) and can render in the gap between
    // an earlier dismiss and this click, intercepting pointer events.
    await this.dismissTutorialIfVisible();
    await roomBtn.click();
  }

  async signOut(): Promise<void> {
    await this.btnLogout.click();
  }
}
