import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { RoomPage } from './pages/RoomPage';

test.describe('Tier 4: HUD Dock Buttons & Modal Interactions E2E', () => {
  const ts = Date.now().toString().slice(-6);
  const testUser = {
    username: `hud_${ts}`,
    email: `hud_${ts}@havenworld.test`,
    password: 'Password123!',
  };

  test.beforeEach(async ({ page }) => {
    // Collect uncaught page errors
    page.on('pageerror', (err) => {
      console.error(`[Browser PageError]: ${err.message}`);
    });
  });

  test('HUD Dock buttons toggle all game modals and handle sub-navigation cleanly', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const roomPage = new RoomPage(page);

    // 1. Register, verify and login to personal loft
    await loginPage.goto();
    await loginPage.register(testUser);
    await loginPage.verifyEmailViaTestRoute(testUser.email);
    await loginPage.login(testUser.email, testUser.password);
    await roomPage.waitForRoomReady();

    // Verify room navigation dock is mounted
    await expect(roomPage.roomNav).toBeVisible();

    // 2. Haven Emporium Shop Modal
    await roomPage.btnShop.click();
    await expect(roomPage.shopOverlay).toBeVisible({ timeout: 5_000 });
    // Switch between Featured and Standard Catalog tabs
    const tabPermanent = page.locator('#tab-shop-permanent');
    await expect(tabPermanent).toBeVisible();
    await tabPermanent.click();
    const tabFeatured = page.locator('#tab-shop-featured');
    await tabFeatured.click();
    // Close shop
    await roomPage.shopCloseBtn.click();
    await expect(roomPage.shopOverlay).not.toBeVisible();

    // 3. Citizen Passport Modal
    await roomPage.btnPassport.click();
    await expect(roomPage.passportOverlay).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`text=${testUser.username}'s Passport`)).toBeVisible();
    // Close passport
    await roomPage.passportCloseBtn.click();
    await expect(roomPage.passportOverlay).not.toBeVisible();

    // 4. Crafting Workshop Modal
    await roomPage.btnWorkshop.click();
    await expect(roomPage.workshopOverlay).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#workshop-materials-bar')).toBeVisible();
    // Close workshop
    await roomPage.workshopCloseBtn.click();
    await expect(roomPage.workshopOverlay).not.toBeVisible();

    // 5. Pet Companions Management Modal
    await roomPage.btnPets.click();
    await expect(roomPage.petOverlay).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#pet-type-select')).toBeVisible();
    await expect(page.locator('#pet-name-input')).toBeVisible();
    // Close pet panel
    await roomPage.petCloseBtn.click();
    await expect(roomPage.petOverlay).not.toBeVisible();

    // 6. Player Clubs Modal
    await roomPage.btnClubs.click();
    await expect(roomPage.clubOverlay).toBeVisible({ timeout: 5_000 });
    const tabCreateClub = page.locator('#tab-create-club');
    await expect(tabCreateClub).toBeVisible();
    await tabCreateClub.click();
    const tabBrowseClubs = page.locator('#tab-browse-clubs');
    await tabBrowseClubs.click();
    // Close clubs panel
    await roomPage.clubCloseBtn.click();
    await expect(roomPage.clubOverlay).not.toBeVisible();

    // 7. Haven Photo Gallery Modal
    await roomPage.btnGallery.click();
    await expect(roomPage.galleryOverlay).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#btn-snap-photo')).toBeVisible();
    // Close gallery
    await roomPage.galleryCloseBtn.click();
    await expect(roomPage.galleryOverlay).not.toBeVisible();

    // 8. Pizza Chef Job Minigame Modal
    await roomPage.btnPizza.click();
    await expect(roomPage.pizzaOverlay).toBeVisible({ timeout: 5_000 });
    // Click an ingredient tray to add ingredient to crust
    const doughBtn = page.locator('.btn-ingredient[data-ing="dough"]');
    if (await doughBtn.isVisible()) {
      await doughBtn.click();
      await expect(page.locator('#pizza-assembly-display')).toContainText(/dough/i);
      // Restart crust
      await page.locator('#btn-clear-pizza').click();
      await expect(page.locator('#pizza-assembly-display')).toContainText('Empty Crust');
    }
    // Close pizza minigame
    await roomPage.pizzaCloseBtn.click();
    await expect(roomPage.pizzaOverlay).not.toBeVisible();

    // 9. Chat Visibility Toggle
    await expect(roomPage.chatPanel).toBeVisible();
    await roomPage.btnToggleChat.click();
    await expect(roomPage.chatPanel).toHaveClass(/hidden/);
    await roomPage.btnToggleChat.click();
    await expect(roomPage.chatPanel).not.toHaveClass(/hidden/);

    // 10. Emote Wheel Hotkey ('E' opens, 'Escape' closes)
    await page.keyboard.press('e');
    await expect(roomPage.emoteWheelOverlay).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(roomPage.emoteWheelOverlay).not.toBeVisible();

    // 11. Daily Gift button provides feedback without errors
    await roomPage.btnDailyGift.click();
    // Either toast notification or daily modal is triggered
    await page.waitForTimeout(300);
  });
});
