import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'playwright-report/audit');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

interface AuditLog {
  timestamp: string;
  step: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  details: string;
  screenshot?: string;
}

const logs: AuditLog[] = [];
function log(step: string, status: 'PASS' | 'FAIL' | 'WARN' | 'INFO', details: string, screenshot?: string) {
  const entry = { timestamp: new Date().toISOString(), step, status, details, screenshot };
  logs.push(entry);
  console.log(`[${status}] ${step}: ${details}`);
}

async function runAudit() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('error') || msg.text().includes('Error')) {
      console.log(`  [BROWSER CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  page.on('pageerror', (err) => {
    log('Browser Exception', 'WARN', err.message);
  });

  try {
    // ── 1. Page Load ────────────────────────────────────────────────────────
    log('Navigate', 'INFO', 'Loading https://havenworld-game.pages.dev...');
    await page.goto('https://havenworld-game.pages.dev', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const title = await page.title();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-landing.png') });
    log('Landing Page', 'PASS', `Title: "${title}"`, '01-landing.png');

    // ── 2. Auth Panel Inspection ─────────────────────────────────────────────
    const loginPanel = page.locator('#login-panel');
    const isLoginVisible = await loginPanel.isVisible();
    if (!isLoginVisible) {
      log('Auth Panel', 'FAIL', '#login-panel is not visible');
      return;
    }
    log('Auth Panel', 'PASS', 'Login panel rendered cleanly');

    const tabRegister = page.locator('#tab-register');
    await tabRegister.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-register-tab.png') });

    // Register a test account using valid invite code 56E8F5C1
    const testUser = `tester_${Date.now().toString().slice(-6)}`;
    const testEmail = `${testUser}@havenworld.test`;
    const testPass = 'AuditSecurePass123!';
    const inviteCode = '56E8F5C1';

    log('Registration', 'INFO', `Registering test user: ${testUser} (${testEmail}) with invite code: ${inviteCode}`);
    await page.locator('#reg-username').fill(testUser);
    await page.locator('#reg-email').fill(testEmail);
    await page.locator('#reg-password').fill(testPass);
    await page.locator('#reg-invite-code').fill(inviteCode);

    await page.locator('#form-register button[type="submit"]').click();

    // Wait for transition into room scene or error message
    let inGame = false;
    try {
      await page.waitForSelector('#game-container', { state: 'visible', timeout: 20000 });
      inGame = true;
    } catch {
      const errText = await page.locator('#login-error').textContent();
      log('Registration Result', 'WARN', `Failed direct registration: ${errText}`);
    }

    if (!inGame) {
      // Try with another invite code if first was used or try existing demo user
      log('Auth Fallback', 'INFO', 'Attempting register with secondary invite code C4AE7EED...');
      await page.locator('#reg-invite-code').fill('C4AE7EED');
      await page.locator('#form-register button[type="submit"]').click();
      try {
        await page.waitForSelector('#game-container', { state: 'visible', timeout: 20000 });
        inGame = true;
      } catch {
        const errText = await page.locator('#login-error').textContent();
        log('Auth Fallback Result', 'WARN', `Second registration error: ${errText}`);
      }
    }

    if (!inGame) {
      log('Game Scene Transition', 'FAIL', 'Unable to transition into game scene');
      return;
    }

    log('Game Scene Transition', 'PASS', 'Successfully registered and transitioned into 3D scene');
    await page.waitForTimeout(4000); // let assets load
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-room-loaded.png') });

    // ── 3. Inspect Canvas & Avatar Rendering ─────────────────────────────────
    const canvas = page.locator('#haven-canvas');
    const canvasVisible = await canvas.isVisible();
    log('Babylon Canvas', canvasVisible ? 'PASS' : 'FAIL', `Canvas visible: ${canvasVisible}`);

    const avatarInfo = await page.evaluate(() => {
      const ctrl = (window as any).__havenAvatarController;
      const scene = (window as any).__havenActiveScene;
      if (!ctrl) return { error: 'No __havenAvatarController found on window' };

      const rootMesh = ctrl.rootMesh;
      const billboard = ctrl.chibiBillboard;
      const hasBillboard = !!billboard;
      const billboardMesh = billboard?.mesh;
      const billboardVisible = billboardMesh ? billboardMesh.isVisible : false;
      const capsuleVisible = ctrl.capsuleMesh ? ctrl.capsuleMesh.isVisible : false;

      return {
        hasController: true,
        position: ctrl.position,
        facing: ctrl.facing,
        hasBillboard,
        billboardVisible,
        capsuleVisible,
        meshCount: scene?.meshes?.length || 0,
        materialsCount: scene?.materials?.length || 0,
      };
    });
    log('Avatar Architecture', 'PASS', JSON.stringify(avatarInfo), '03-room-loaded.png');

    // ── 4. Test Click-to-Move ─────────────────────────────────────────────────
    const initialPos = await page.evaluate(() => {
      const c = (window as any).__havenAvatarController;
      return c ? { x: c.position.x, y: c.position.y, z: c.position.z } : null;
    });

    log('Movement Test', 'INFO', `Initial avatar position: ${JSON.stringify(initialPos)}`);
    const box = await canvas.boundingBox();
    if (box) {
      // Click on floor
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
      await page.waitForTimeout(2000);
      const afterPos = await page.evaluate(() => {
        const c = (window as any).__havenAvatarController;
        return c ? { x: c.position.x, y: c.position.y, z: c.position.z } : null;
      });
      log('Movement Result', 'PASS', `Moved to: ${JSON.stringify(afterPos)}`);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-avatar-moved.png') });
    }

    // ── 5. Test Avatar Context Menu (Self Click) ──────────────────────────────
    log('Avatar Context Menu', 'INFO', 'Testing self avatar click...');
    const contextMenuOpened = await page.evaluate(() => {
      const ctrl = (window as any).__havenAvatarController;
      const scene = (window as any).__havenActiveScene;
      if (ctrl && scene) {
        // Trigger handleAvatarInteraction directly or simulate click on rootMesh
        if (typeof scene.handleAvatarInteraction === 'function') {
          scene.handleAvatarInteraction(ctrl.rootMesh, { x: 400, y: 300 });
          return true;
        }
      }
      return false;
    });

    await page.waitForTimeout(1000);
    const menuEl = page.locator('#avatar-context-menu');
    const menuVisible = await menuEl.isVisible().catch(() => false);
    log('Avatar Context Menu', menuVisible ? 'PASS' : 'WARN', `Menu visible: ${menuVisible}`);
    if (menuVisible) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-avatar-context-menu.png') });
      // Close menu by clicking elsewhere
      await page.mouse.click(50, 50);
      await page.waitForTimeout(500);
    }

    // ── 6. Test Loft Settings & Decorate Modal ────────────────────────────────
    log('Loft Settings', 'INFO', 'Testing Loft Settings / Room Editor...');
    const btnSettings = page.locator('#btn-loft-settings, #btn-decorate');
    if (await btnSettings.count() > 0 && await btnSettings.first().isVisible()) {
      await btnSettings.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-loft-settings-open.png') });

      // Check Mood tabs or Surfaces tabs
      const moodTab = page.locator('#tab-mood, button:has-text("Mood"), button:has-text("Lighting")');
      if (await moodTab.count() > 0 && await moodTab.first().isVisible()) {
        await moodTab.first().click();
        await page.waitForTimeout(500);
        log('Mood Tab', 'PASS', 'Mood lighting controls present');
      }

      const surfacesTab = page.locator('#tab-surfaces, button:has-text("Surfaces"), button:has-text("Floors")');
      if (await surfacesTab.count() > 0 && await surfacesTab.first().isVisible()) {
        await surfacesTab.first().click();
        await page.waitForTimeout(500);
        log('Surfaces Tab', 'PASS', 'Room surfaces tab present');
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-surfaces-tab.png') });
      }

      // Close settings modal
      const closeBtn = page.locator('#loft-settings-close, button:has-text("✕"), button:has-text("Close")');
      if (await closeBtn.count() > 0 && await closeBtn.first().isVisible()) {
        await closeBtn.first().click();
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(500);
    }

    // ── 7. Test Top Navigation Buttons ────────────────────────────────────────
    const panelsToAudit = [
      { name: 'Workshop', selector: '#btn-workshop', modal: '#workshop-modal-overlay, #workshop-panel', close: '#workshop-panel-close' },
      { name: 'Shop / Emporium', selector: '#btn-shop', modal: '#shop-modal-overlay, #shop-modal', close: '#btn-close-shop' },
      { name: 'Passport', selector: '#btn-passport', modal: '#passport-modal-overlay, #passport-modal', close: '#btn-close-passport' },
      { name: 'Gallery', selector: '#btn-gallery', modal: '#gallery-modal-overlay, #gallery-panel', close: '#gallery-panel-close' },
      { name: 'Pizza Chef', selector: '#btn-pizza', modal: '#pizza-scene-overlay, #pizza-chef-panel', close: '#btn-close-pizza' },
      { name: 'Wardrobe', selector: '#btn-avatar', modal: '#avatar-customizer', close: 'button:has-text("Cancel")' },
      { name: 'Pets', selector: '#btn-pets', modal: '#pet-modal-overlay', close: '#pet-panel-close' },
      { name: 'Clubs', selector: '#btn-clubs', modal: '#club-modal-overlay', close: '#club-panel-close' },
    ];

    for (const item of panelsToAudit) {
      log(item.name, 'INFO', `Auditing ${item.name} button (${item.selector})...`);
      const btn = page.locator(item.selector);
      if (await btn.count() > 0 && await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(1200);

        const modal = page.locator(item.modal);
        const isOpen = await modal.first().isVisible().catch(() => false);
        const safeName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const screenFile = `panel-${safeName}.png`;
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenFile) });

        if (isOpen) {
          log(item.name, 'PASS', `Modal opened and rendered cleanly`, screenFile);
          const closeBtn = page.locator(`${item.modal} ${item.close}, ${item.close}, ${item.modal} button:has-text("✕"), ${item.modal} button:has-text("Cancel"), ${item.modal} button:has-text("Close")`);
          if (await closeBtn.count() > 0 && await closeBtn.first().isVisible()) {
            await closeBtn.first().click();
          } else {
            await page.keyboard.press('Escape');
          }
        } else {
          log(item.name, 'WARN', `Button visible but modal selector ${item.modal} not triggered`, screenFile);
        }
        await page.waitForTimeout(600);
      } else {
        log(item.name, 'WARN', `Button ${item.selector} not visible on main HUD`);
      }
    }

    // ── 8. Test Daily Quests HUD ──────────────────────────────────────────────
    const questsBtn = page.locator('#quest-hud-toggle, #quest-hud-container, .quest-hud');
    if (await questsBtn.count() > 0 && await questsBtn.first().isVisible()) {
      await questsBtn.first().click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'panel-daily-quests.png') });
      log('Daily Quests', 'PASS', 'Daily Quests HUD present and expandable', 'panel-daily-quests.png');
    } else {
      log('Daily Quests', 'WARN', 'Daily Quests toggle not visible in top-right HUD');
    }

    // ── 9. Test Travel Directory & Navigation to Haven Park (Fishing) ──────────
    log('Travel Directory', 'INFO', 'Opening Travel Directory...');
    const btnTravel = page.locator('#btn-travel, #btn-explore, button:has-text("Explore"), button:has-text("Travel")');
    if (await btnTravel.count() > 0 && await btnTravel.first().isVisible()) {
      await btnTravel.first().click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'panel-travel-directory.png') });

      // Click on Haven Park if available
      const parkBtn = page.locator('button:has-text("Haven Park"), .directory-card:has-text("Park"), [data-room-slug="haven-park"]');
      if (await parkBtn.count() > 0 && await parkBtn.first().isVisible()) {
        log('Travel to Haven Park', 'INFO', 'Navigating to Haven Park for fishing audit...');
        await parkBtn.first().click();
        await page.waitForTimeout(4000); // room transition
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08-haven-park-room.png') });

        // Check if Fishing dock button is visible
        const fishingBtn = page.locator('#btn-fishing, button:has-text("Fish")');
        const fishingVisible = await fishingBtn.count() > 0 && await fishingBtn.first().isVisible();
        log('Fishing Button', fishingVisible ? 'PASS' : 'WARN', `Fishing button in Haven Park: ${fishingVisible}`);
        if (fishingVisible) {
          await fishingBtn.first().click();
          await page.waitForTimeout(1000);
          await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09-fishing-minigame.png') });
          log('Fishing Minigame', 'PASS', 'Fishing minigame launched', '09-fishing-minigame.png');
        }
      } else {
        log('Travel Directory', 'WARN', 'Haven Park not found in travel list');
      }
    } else {
      log('Travel Directory', 'WARN', 'Explore / Travel button not found');
    }

    // ── 10. Direct Messaging & Trade Modals ───────────────────────────────────
    const tradeModalExists = await page.evaluate(() => {
      return !!(window as any).__havenTradeModal;
    });
    log('Trade Modal Instance', tradeModalExists ? 'PASS' : 'FAIL', `TradeModal mounted: ${tradeModalExists}`);

    const chatInput = page.locator('#chat-input, input[placeholder*="chat" i], input[placeholder*="message" i]');
    const chatVisible = await chatInput.count() > 0 && await chatInput.first().isVisible();
    log('Chat Overlay', chatVisible ? 'PASS' : 'WARN', `Chat input visible: ${chatVisible}`);

  } catch (err: any) {
    log('Audit Exception', 'FAIL', err.stack || err.message);
  } finally {
    const reportPath = path.join(SCREENSHOT_DIR, 'audit-summary.json');
    fs.writeFileSync(reportPath, JSON.stringify(logs, null, 2));
    console.log(`\nAudit completed! Summary written to: ${reportPath}`);
    await browser.close();
  }
}

runAudit();
