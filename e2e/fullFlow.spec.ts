import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { LobbyPage } from './pages/LobbyPage';
import { RoomPage } from './pages/RoomPage';

test.describe('Tier 4: Full Game Flow E2E', () => {
  const timestamp = Date.now();
  const testUser = {
    username: `e2e_${timestamp}`,
    email: `e2e_${timestamp}@havenworld.test`,
    password: 'SecurePassword123!',
  };

  test('Complete user journey: register -> verify -> login -> loft -> park -> chat -> logout', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const lobbyPage = new LobbyPage(page);
    const roomPage = new RoomPage(page);

    // Step 1: Open site & Register
    await loginPage.goto();
    await loginPage.register({
      username: testUser.username,
      email: testUser.email,
      password: testUser.password,
    });

    // Step 2: Verify email via server test route
    await loginPage.verifyEmailViaTestRoute(testUser.email);

    // Step 3: Login with verified credentials
    await loginPage.login(testUser.email, testUser.password);

    // Step 4: Verify auto-redirect to Personal Loft or Lobby
    // Wait for room canvas or lobby to be ready
    await Promise.race([
      roomPage.waitForRoomReady(20_000),
      lobbyPage.waitForLoaded(),
    ]);

    // If landed in lobby, enter a room; if directly in loft, proceed
    const isLobbyVisible = await lobbyPage.lobbyPanel.isVisible();
    if (isLobbyVisible) {
      await lobbyPage.selectPublicTab();
      await lobbyPage.enterRoom('Haven Park');
      await roomPage.waitForRoomReady(20_000);
    }

    // Step 5: Travel / Navigation in room
    expect(await roomPage.canvas.isVisible()).toBe(true);
    await roomPage.clickCanvas(300, 300);

    // Step 6: Send chat message and verify in log
    const chatText = `E2E message from ${testUser.username}`;
    await roomPage.sendChatMessage(chatText);
    await roomPage.waitForChatMessage(chatText);

    // Step 7: Clean Sign Out
    await roomPage.signOut();
    await expect(loginPage.loginPanel).toBeVisible();
  });
});
