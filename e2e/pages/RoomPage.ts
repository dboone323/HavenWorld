import { Page, Locator, expect } from '@playwright/test';

export interface AvatarState {
  x: number;
  y: number;
  z: number;
  rotY: number;
  isMoving: boolean;
}

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

  // Docks & Navigation
  readonly btnPark: Locator;
  readonly btnMyLoft: Locator;
  readonly btnBrowseLofts: Locator;
  readonly btnAvatar: Locator;
  readonly btnSignOut: Locator;
  readonly btnShop: Locator;
  readonly btnPassport: Locator;
  readonly btnClubs: Locator;
  readonly btnGallery: Locator;
  readonly btnWorkshop: Locator;
  readonly btnPets: Locator;
  readonly btnPizza: Locator;
  readonly btnFishing: Locator;
  readonly btnDecorate: Locator;
  readonly btnLoftSettings: Locator;
  readonly btnToggleChat: Locator;
  readonly btnDailyGift: Locator;
  readonly chkRoomLock: Locator;

  // Room Info Pill & Cards
  readonly roomInfoPill: Locator;
  readonly roomNameDisplay: Locator;
  readonly roomControlsCard: Locator;

  // Modals & Panels
  readonly avatarPanel: Locator;
  readonly shopOverlay: Locator;
  readonly shopCloseBtn: Locator;
  readonly passportOverlay: Locator;
  readonly passportCloseBtn: Locator;
  readonly workshopOverlay: Locator;
  readonly workshopCloseBtn: Locator;
  readonly petOverlay: Locator;
  readonly petCloseBtn: Locator;
  readonly clubOverlay: Locator;
  readonly clubCloseBtn: Locator;
  readonly galleryOverlay: Locator;
  readonly galleryCloseBtn: Locator;
  readonly pizzaOverlay: Locator;
  readonly pizzaCloseBtn: Locator;
  readonly fishingHud: Locator;
  readonly fishingCancelBtn: Locator;
  readonly roomEditorInventory: Locator;
  readonly btnEditorRotate: Locator;
  readonly editorRotLabel: Locator;
  readonly btnCloseEditor: Locator;
  readonly loftSettingsClose: Locator;
  readonly emoteWheelOverlay: Locator;

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

    // Navigation & Dock buttons
    this.btnPark = page.locator('[data-testid="btn-park"]');
    this.btnMyLoft = page.locator('[data-testid="btn-my-loft"]');
    this.btnBrowseLofts = page.locator('[data-testid="btn-browse-lofts"]');
    this.btnAvatar = page.locator('[data-testid="btn-avatar"]');
    this.btnSignOut = page.locator('[data-testid="btn-nav-logout"]');
    this.btnShop = page.locator('[data-testid="btn-shop"]');
    this.btnPassport = page.locator('[data-testid="btn-passport"]');
    this.btnClubs = page.locator('[data-testid="btn-clubs"]');
    this.btnGallery = page.locator('[data-testid="btn-gallery"]');
    this.btnWorkshop = page.locator('[data-testid="btn-workshop"]');
    this.btnPets = page.locator('[data-testid="btn-pets"]');
    this.btnPizza = page.locator('[data-testid="btn-pizza"]');
    this.btnFishing = page.locator('[data-testid="btn-fishing"]');
    this.btnDecorate = page.locator('[data-testid="btn-decorate"]');
    this.btnLoftSettings = page.locator('[data-testid="btn-loft-settings"]');
    this.btnToggleChat = page.locator('[data-testid="btn-toggle-chat"]');
    this.btnDailyGift = page.locator('[data-testid="btn-daily-gift"]');
    this.chkRoomLock = page.locator('#chk-room-lock');

    // Header info pill
    this.roomInfoPill = page.locator('#room-info-pill');
    this.roomNameDisplay = page.locator('#room-name-display');
    this.roomControlsCard = page.locator('#room-controls-card');

    // Modals
    this.avatarPanel = page.locator('[data-testid="avatar-customizer"]');
    this.shopOverlay = page.locator('#shop-modal-overlay');
    this.shopCloseBtn = page.locator('#btn-close-shop');
    this.passportOverlay = page.locator('#passport-modal-overlay');
    this.passportCloseBtn = page.locator('#btn-close-passport');
    this.workshopOverlay = page.locator('#workshop-modal-overlay');
    this.workshopCloseBtn = page.locator('#workshop-panel-close');
    this.petOverlay = page.locator('#pet-modal-overlay');
    this.petCloseBtn = page.locator('#pet-panel-close');
    this.clubOverlay = page.locator('#club-modal-overlay');
    this.clubCloseBtn = page.locator('#club-panel-close');
    this.galleryOverlay = page.locator('#gallery-modal-overlay');
    this.galleryCloseBtn = page.locator('#gallery-panel-close');
    this.pizzaOverlay = page.locator('#pizza-scene-overlay');
    this.pizzaCloseBtn = page.locator('#btn-close-pizza');
    this.fishingHud = page.locator('#fishing-hud');
    this.fishingCancelBtn = page.locator('#btn-cancel-fishing');
    this.roomEditorInventory = page.locator('#room-editor-inventory');
    this.btnEditorRotate = page.locator('#btn-editor-rotate');
    this.editorRotLabel = page.locator('#editor-rot-label');
    this.btnCloseEditor = page.locator('#btn-close-editor');
    this.loftSettingsClose = page.locator('#loft-settings-close');
    this.emoteWheelOverlay = page.locator('#emote-wheel-overlay');
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

  /**
   * Real browser evaluation: reads the 3D position and moving state of the local avatar directly from Babylon.js.
   */
  async getAvatarState(): Promise<AvatarState | null> {
    return this.page.evaluate(() => {
      const fn = (window as any).__havenGetAvatarPosition;
      if (typeof fn === 'function') {
        return fn();
      }
      const ac = (window as any).__havenAvatarController;
      if (!ac || !ac.rootMesh) return null;
      return {
        x: ac.rootMesh.position.x,
        y: ac.rootMesh.position.y,
        z: ac.rootMesh.position.z,
        rotY: ac.rootMesh.rotation.y,
        isMoving: Boolean(ac.isMoving),
      };
    });
  }

  /**
   * Waits for the avatar to complete moving to its target destination.
   */
  async waitForAvatarArrival(timeout = 10_000): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const fn = (window as any).__havenGetAvatarPosition;
        const state = typeof fn === 'function' ? fn() : null;
        return state && state.isMoving === false;
      },
      { timeout }
    );
  }
}
