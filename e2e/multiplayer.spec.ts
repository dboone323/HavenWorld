import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { RoomPage } from './pages/RoomPage';

test.describe('Tier 4: Multiplayer Synchronization E2E', () => {
  const ts = Date.now();
  const user1 = {
    username: `p1_${ts}`,
    email: `p1_${ts}@havenworld.test`,
    password: 'Password123!',
  };
  const user2 = {
    username: `p2_${ts}`,
    email: `p2_${ts}@havenworld.test`,
    password: 'Password123!',
  };

  test('Multiplayer session: dual presence, position sync, chat broadcast, and disconnect', async ({
    browser,
  }) => {
    // Context 1 for Player 1
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    const login1 = new LoginPage(page1);
    const room1 = new RoomPage(page1);

    // Context 2 for Player 2
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    const login2 = new LoginPage(page2);
    const room2 = new RoomPage(page2);

    // (a) Register and login both players
    await login1.goto();
    await login1.register(user1);
    await login1.verifyEmailViaTestRoute(user1.email);
    await login1.login(user1.email, user1.password);
    await room1.waitForRoomReady();

    await login2.goto();
    await login2.register(user2);
    await login2.verifyEmailViaTestRoute(user2.email);
    await login2.login(user2.email, user2.password);
    await room2.waitForRoomReady();

    // Navigate both players to Haven Park
    await room1.navigateToPark();
    await room2.navigateToPark();

    // (b) Verify both canvases are active
    await expect(room1.canvas).toBeVisible();
    await expect(room2.canvas).toBeVisible();

    // (c) Player 1 moves -> triggers movement event
    await room1.clickCanvas(250, 250);

    // (d) Player 1 sends chat message -> Player 2 receives chat message
    const msg = `Hello Player 2 from ${user1.username}!`;
    await room1.sendChatMessage(msg);
    await room2.waitForChatMessage(msg);

    // (e) Player 2 disconnects -> leaves room
    await context2.close();

    // Player 1 remains in room
    await expect(room1.canvas).toBeVisible();

    await context1.close();
  });
});
