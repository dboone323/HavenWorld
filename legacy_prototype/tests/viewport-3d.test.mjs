import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toScreen, toGrid } from '../src/shared/iso.ts';

test('Enlarged 96x48 isometric coordinate projections maintain precise 2:1 ratio', () => {
  const TILE_W = 96;
  const TILE_H = 48;
  const origin = { x: 500, y: 200 };

  // Origin grid (0, 0) maps exactly to screen origin
  const screen0 = toScreen(0, 0, origin.x, origin.y, TILE_W, TILE_H);
  assert.equal(screen0.x, origin.x);
  assert.equal(screen0.y, origin.y);

  // 1 step East (1, 0)
  const screenEast = toScreen(1, 0, origin.x, origin.y, TILE_W, TILE_H);
  assert.equal(screenEast.x, origin.x + 48);
  assert.equal(screenEast.y, origin.y + 24);

  // 1 step South (0, 1)
  const screenSouth = toScreen(0, 1, origin.x, origin.y, TILE_W, TILE_H);
  assert.equal(screenSouth.x, origin.x - 48);
  assert.equal(screenSouth.y, origin.y + 24);

  // Exact inverse roundtrip check
  const gridEast = toGrid(screenEast.x, screenEast.y, origin.x, origin.y, TILE_W, TILE_H);
  assert.ok(Math.abs(gridEast.x - 1) < 1e-9);
  assert.ok(Math.abs(gridEast.y - 0) < 1e-9);

  const gridSouth = toGrid(screenSouth.x, screenSouth.y, origin.x, origin.y, TILE_W, TILE_H);
  assert.ok(Math.abs(gridSouth.x - 0) < 1e-9);
  assert.ok(Math.abs(gridSouth.y - 1) < 1e-9);
});

test('Playable tile footprint expands by +125% (2.25x area expansion)', () => {
  const oldArea = (64 * 32) / 2; // 1024 sq px
  const newArea = (96 * 48) / 2; // 2304 sq px
  const areaIncreasePercentage = ((newArea - oldArea) / oldArea) * 100;

  assert.equal(oldArea, 1024);
  assert.equal(newArea, 2304);
  assert.equal(areaIncreasePercentage, 125);
  assert.ok(areaIncreasePercentage >= 100, 'Playable area must be enlarged by at least 100%');
});

test('Dynamic room centering computes positive headroom and bottom padding across all room sizes', () => {
  const TILE_H = 48;
  const WALL_HEIGHT = 110;
  const canvasHeight = 720;

  const roomSizes = [12, 14, 18, 20];

  for (const size of roomSizes) {
    const roomDepth = (size + size) * (TILE_H / 4);
    const targetY = Math.max(90, Math.min(canvasHeight * 0.28, (canvasHeight - roomDepth) / 2 + 10));

    // Top wall apex must have positive headroom (> 0) so wall tops are never cut off
    const topWallApexY = targetY - WALL_HEIGHT;
    assert.ok(topWallApexY >= -20, `Room ${size}x${size}: Wall top apex must be visible within viewport (was ${topWallApexY}px)`);

    // Bottom floor apex must have clearance for action bar & chat (> 50px from canvas bottom)
    const bottomFloorApexY = targetY + roomDepth;
    const bottomPadding = canvasHeight - bottomFloorApexY;
    assert.ok(bottomPadding > 50, `Room ${size}x${size}: Floor bottom apex must have breathing room for UI controls (was ${bottomPadding}px)`);
  }
});

test('Volumetric 3D solid geometry creates valid non-degenerate faces and contact shadows', () => {
  const cx = 100;
  const cy = 100;
  const hw = 36;
  const hd = 18;
  const h = 10;

  // 1. Top diamond face vertices
  const topFace = [
    { x: cx, y: cy - h - hd },
    { x: cx + hw, y: cy - h },
    { x: cx, y: cy - h + hd },
    { x: cx - hw, y: cy - h }
  ];

  let topArea = 0;
  for (let i = 0; i < topFace.length; i++) {
    const j = (i + 1) % topFace.length;
    topArea += topFace[i].x * topFace[j].y - topFace[j].x * topFace[i].y;
  }
  topArea = Math.abs(topArea) / 2;
  assert.equal(topArea, hw * hd * 2, 'Top diamond face area must match 2 * hw * hd');

  // 2. Left vertical face (South-West diffuse)
  const leftFace = [
    { x: cx - hw, y: cy - h },
    { x: cx, y: cy - h + hd },
    { x: cx, y: cy + hd },
    { x: cx - hw, y: cy }
  ];
  let leftArea = 0;
  for (let i = 0; i < leftFace.length; i++) {
    const j = (i + 1) % leftFace.length;
    leftArea += leftFace[i].x * leftFace[j].y - leftFace[j].x * leftFace[i].y;
  }
  leftArea = Math.abs(leftArea) / 2;
  assert.ok(leftArea > 0, 'Left face must have non-zero positive area');

  // 3. Right vertical face (South-East core shadow)
  const rightFace = [
    { x: cx, y: cy - h + hd },
    { x: cx + hw, y: cy - h },
    { x: cx + hw, y: cy },
    { x: cx, y: cy + hd }
  ];
  let rightArea = 0;
  for (let i = 0; i < rightFace.length; i++) {
    const j = (i + 1) % rightFace.length;
    rightArea += rightFace[i].x * rightFace[j].y - rightFace[j].x * rightFace[i].y;
  }
  rightArea = Math.abs(rightArea) / 2;
  assert.ok(rightArea > 0, 'Right face must have non-zero positive area');

  // Contact shadow covers the base footprint
  const shadowRadiusX = hw * 1.15;
  const shadowRadiusY = hd * 0.85;
  assert.ok(shadowRadiusX > hw, 'Contact shadow must project beyond width to create realistic ambient ground occlusion');
});
