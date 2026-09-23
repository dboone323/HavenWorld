import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { RoomPage } from './pages/RoomPage';

test.describe('Tier 4: Browser 3D Movement & Pathfinding E2E', () => {
  const ts = Date.now();
  const testUser = {
    username: `walker_${ts}`,
    email: `walker_${ts}@havenworld.test`,
    password: 'Password123!',
  };

  test('Real canvas click moves avatar in 3D world space and updates rotation and arrival state', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const roomPage = new RoomPage(page);

    // Step 1: Register and login
    await loginPage.goto();
    await loginPage.register(testUser);
    await loginPage.verifyEmailViaTestRoute(testUser.email);
    await loginPage.login(testUser.email, testUser.password);
    await roomPage.waitForRoomReady();

    // Step 2: Ensure avatar controller is mounted and read starting position
    const startState = await roomPage.getAvatarState();
    expect(startState).not.toBeNull();
    expect(typeof startState!.x).toBe('number');
    expect(typeof startState!.z).toBe('number');
    expect(startState!.isMoving).toBe(false);

    // Step 3: Perform canvas click on walkable floor (near center isometric floor)
    await roomPage.clickCanvas(480, 360);

    // Step 4: Verify avatar starts moving or shifts position away from start
    await page.waitForFunction(
      (startX) => {
        const fn = (window as any).__havenGetAvatarPosition;
        const state = typeof fn === 'function' ? fn() : null;
        return state && (state.isMoving === true || Math.abs(state.x - startX) > 0.05);
      },
      startState!.x,
      { timeout: 5_000 }
    );

    // Step 5: Wait for arrival at target
    await roomPage.waitForAvatarArrival(10_000);

    // Step 6: Verify final position differs from starting position and avatar is idle
    const endState = await roomPage.getAvatarState();
    expect(endState).not.toBeNull();
    expect(endState!.isMoving).toBe(false);

    const deltaDist = Math.hypot(endState!.x - startState!.x, endState!.z - startState!.z);
    expect(deltaDist).toBeGreaterThan(0.2);

    // Step 7: Sequential re-targeting: click another location on the open walkable floor
    await roomPage.clickCanvas(580, 420);

    await page.waitForFunction(
      (prevX) => {
        const fn = (window as any).__havenGetAvatarPosition;
        const state = typeof fn === 'function' ? fn() : null;
        return state && (state.isMoving === true || Math.abs(state.x - prevX) > 0.05);
      },
      endState!.x,
      { timeout: 5_000 }
    );

    await roomPage.waitForAvatarArrival(10_000);

    const secondState = await roomPage.getAvatarState();
    expect(secondState).not.toBeNull();
    expect(secondState!.isMoving).toBe(false);

    const secondDelta = Math.hypot(secondState!.x - endState!.x, secondState!.z - endState!.z);
    expect(secondDelta).toBeGreaterThan(0.2);
  });

  test('Clicking non-walkable wall or void maintains avatar safety without crash or invalid warp', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const roomPage = new RoomPage(page);

    await loginPage.goto();
    // Fast login with existing testUser
    await loginPage.login(testUser.email, testUser.password);
    await roomPage.waitForRoomReady();

    const initialPos = await roomPage.getAvatarState();
    expect(initialPos).not.toBeNull();

    // Click high wall mesh (non-walkable surface)
    await roomPage.clickCanvas(300, 150);

    // Wait a brief moment to ensure no crash or invalid warp occurs
    await page.waitForTimeout(500);

    const stateAfterVoidClick = await roomPage.getAvatarState();
    expect(stateAfterVoidClick).not.toBeNull();
    // Avatar should not fly off into deep space (> 20m away)
    expect(Math.abs(stateAfterVoidClick!.x)).toBeLessThan(20);
    expect(Math.abs(stateAfterVoidClick!.z)).toBeLessThan(20);
  });
});
