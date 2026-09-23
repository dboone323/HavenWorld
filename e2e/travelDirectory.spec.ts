import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { LobbyPage } from './pages/LobbyPage';
import { RoomPage } from './pages/RoomPage';

test.describe('Tier 4: Travel Directory, Multi-Room Navigation & Fishing E2E', () => {
  const ts = Date.now().toString().slice(-6);
  const testUser = {
    username: `trv_${ts}`,
    email: `trv_${ts}@havenworld.test`,
    password: 'Password123!',
  };

  test('Lobby directory tabs, transition to Haven Park, fishing HUD minigame, and return to personal loft', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const lobbyPage = new LobbyPage(page);
    const roomPage = new RoomPage(page);

    // 1. Register and login
    await loginPage.goto();
    await loginPage.register(testUser);
    await loginPage.verifyEmailViaTestRoute(testUser.email);
    await loginPage.login(testUser.email, testUser.password);
    await roomPage.waitForRoomReady();

    // 2. In Personal Loft: verify room name and verify fishing dock button is absent
    await expect(roomPage.roomNameDisplay).toContainText('Sanctuary Loft');
    await expect(roomPage.btnFishing).toBeHidden();

    // 3. Open Travel & Directory (Lobby)
    await roomPage.btnBrowseLofts.click();
    await lobbyPage.waitForLoaded();

    // 4. Test directory tabs
    await lobbyPage.selectLoftsTab();
    await expect(lobbyPage.tabLofts).toHaveClass(/tab--active/);
    await lobbyPage.selectPublicTab();
    await expect(lobbyPage.tabPublic).toHaveClass(/tab--active/);

    // 5. Enter Haven Park from public space directory
    await lobbyPage.enterRoom('Haven Park');
    await roomPage.waitForRoomReady();

    // 6. In Haven Park: verify park header pill and active fishing button
    await expect(roomPage.roomNameDisplay).toContainText('Haven Park & Plaza');
    await expect(roomPage.btnFishing).toBeVisible({ timeout: 5_000 });

    // 7. Start Fishing minigame
    await roomPage.btnFishing.click();
    await expect(roomPage.fishingHud).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#fish-status')).toHaveText(/(Waiting for a bite|took the bait)/);

    // 8. Cancel fishing
    await roomPage.fishingCancelBtn.click();
    await expect(roomPage.fishingHud).not.toBeVisible();

    // 9. Fast-travel back to personal loft
    await roomPage.navigateToLoft();
    await expect(roomPage.roomNameDisplay).toContainText('Sanctuary Loft');
    await expect(roomPage.btnFishing).toBeHidden();
  });
});
