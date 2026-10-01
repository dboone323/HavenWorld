/**
 * PetController.ts
 *
 * Renders a 2D Chibi-style animal billboard for the player's pet using
 * DynamicTexture + CanvasRenderingContext2D — matching the ChibiBillboard.ts
 * pattern so pets feel native to the Babylon.js isometric world.
 *
 * Species supported:
 *   CAT         — orange tabby with pointed ears, pink inner ear, whiskers, swaying tail
 *   DOG         — brown with floppy ears, snout, wagging tail
 *   BABY_DRAGON — emerald with golden horns, leathery wing membranes, spiky tail tip
 *
 * AI States (port from legacy_prototype/src/client/shared/pet.js):
 *   IDLE    — gentle breathing scale oscillation + tail sway
 *   WANDER  — hop cycle toward random nearby point, facing movement direction
 *   FOLLOW  — faster hop cycle tracking owner root mesh
 *   SLEEP   — curled pose (slightly squished) + floating Zzz label
 *   REACT   — vertical bounce + ❤ particle burst on petting
 *
 * FIX LOG (2026-09-30):
 *   - Replaced two MeshBuilder.CreateSphere() primitives (body + head) with a
 *     DynamicTexture billboard quad that draws species-specific Canvas 2D art.
 *   - Added 5-state AI animation loop with per-tick state transitions.
 *   - Added ROOM_STATE / onRoomJoin support (spawned by RoomScene, not only
 *     on PET_ADOPTED event).
 */

import {
  Scene,
  TransformNode,
  MeshBuilder,
  Vector3,
  AbstractMesh,
  DynamicTexture,
  StandardMaterial,
  Color3,
} from '@babylonjs/core';
import { AdvancedDynamicTexture, TextBlock } from '@babylonjs/gui';
import { socketService } from '../services/socket';
import { SOCKET_EVENTS, type PetType } from '@havenworld/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PetData {
  id: string;
  name: string;
  petType: PetType;
  happiness: number;
  hunger: number;
}

type PetState = 'IDLE' | 'WANDER' | 'FOLLOW' | 'SLEEP' | 'REACT';

// ─── Constants ────────────────────────────────────────────────────────────────

const TEX_W = 128;
const TEX_H = 128;

/** Billboard quad size in Babylon units. */
const QUAD_W = 0.9;
const QUAD_H = 0.9;

/** How far from the owner the pet will begin following (Babylon units). */
const FOLLOW_DISTANCE = 2.0;
/** Speed when following owner (units per tick). */
const FOLLOW_SPEED = 0.06;
/** Speed when wandering (units per tick). */
const WANDER_SPEED = 0.03;
/** Radius of the random wander target sphere around the pet's current position. */
const WANDER_RADIUS = 3.5;
/** Seconds idle before transitioning to WANDER. */
const IDLE_TO_WANDER_SECS = 8;
/** Seconds wandering before returning to IDLE. */
const WANDER_TO_IDLE_SECS = 5;
/** Seconds idle before falling ASLEEP. */
const IDLE_TO_SLEEP_SECS = 30;

// ─── Canvas art helpers ───────────────────────────────────────────────────────

function drawCat(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, tailAngle: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(0, 48 * scale, 22 * scale, 6 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.ellipse(0, 20 * scale, 20 * scale, 22 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(0, -8 * scale, 18 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Ears (left and right pointed triangles)
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.moveTo(-14 * scale, -20 * scale);
  ctx.lineTo(-22 * scale, -38 * scale);
  ctx.lineTo(-4 * scale, -26 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14 * scale, -20 * scale);
  ctx.lineTo(22 * scale, -38 * scale);
  ctx.lineTo(4 * scale, -26 * scale);
  ctx.closePath();
  ctx.fill();

  // Inner ear (pink)
  ctx.fillStyle = '#fda4af';
  ctx.beginPath();
  ctx.moveTo(-14 * scale, -23 * scale);
  ctx.lineTo(-19 * scale, -35 * scale);
  ctx.lineTo(-7 * scale, -27 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14 * scale, -23 * scale);
  ctx.lineTo(19 * scale, -35 * scale);
  ctx.lineTo(7 * scale, -27 * scale);
  ctx.closePath();
  ctx.fill();

  // Face markings (tabby stripes)
  ctx.strokeStyle = '#c2410c';
  ctx.lineWidth = 1.5 * scale;
  for (const sx of [-6, 0, 6]) {
    ctx.beginPath();
    ctx.moveTo(sx * scale, -18 * scale);
    ctx.lineTo(sx * scale, -12 * scale);
    ctx.stroke();
  }

  // Eyes
  ctx.fillStyle = '#16a34a';
  ctx.beginPath();
  ctx.ellipse(-6 * scale, -10 * scale, 4 * scale, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(6 * scale, -10 * scale, 4 * scale, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pupils
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(-6 * scale, -10 * scale, 2 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(6 * scale, -10 * scale, 2 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eye shine
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-5 * scale, -12 * scale, 1.5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(7 * scale, -12 * scale, 1.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#fb7185';
  ctx.beginPath();
  ctx.moveTo(0, -4 * scale);
  ctx.lineTo(-2.5 * scale, -2 * scale);
  ctx.lineTo(2.5 * scale, -2 * scale);
  ctx.closePath();
  ctx.fill();

  // Whiskers
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = scale;
  for (const [sx, ex, y] of [
    [-2, -16, -2],
    [-2, -16, 0],
    [2, 16, -2],
    [2, 16, 0],
  ]) {
    ctx.beginPath();
    ctx.moveTo(sx * scale, y * scale);
    ctx.lineTo(ex * scale, y * scale);
    ctx.stroke();
  }

  // Tail (curving based on tailAngle)
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 4 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(16 * scale, 20 * scale);
  ctx.quadraticCurveTo(
    (22 + Math.sin(tailAngle) * 8) * scale,
    (-2 + Math.cos(tailAngle) * 6) * scale,
    (18 + Math.sin(tailAngle) * 14) * scale,
    (-12 + Math.cos(tailAngle) * 10) * scale,
  );
  ctx.stroke();

  ctx.restore();
}

function drawDog(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, tailAngle: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(0, 50 * scale, 24 * scale, 6 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = '#92400e';
  ctx.beginPath();
  ctx.ellipse(0, 22 * scale, 22 * scale, 24 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#a16207';
  ctx.beginPath();
  ctx.arc(0, -6 * scale, 20 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Floppy ears
  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.ellipse(-20 * scale, 2 * scale, 8 * scale, 14 * scale, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(20 * scale, 2 * scale, 8 * scale, 14 * scale, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Snout
  ctx.fillStyle = '#d97706';
  ctx.beginPath();
  ctx.ellipse(0, 2 * scale, 10 * scale, 8 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.ellipse(0, -2 * scale, 5 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.arc(-7 * scale, -10 * scale, 4 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(7 * scale, -10 * scale, 4 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-6 * scale, -12 * scale, 1.5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(8 * scale, -12 * scale, 1.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Wagging tail
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 5 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-18 * scale, 20 * scale);
  ctx.quadraticCurveTo(
    (-28 + Math.sin(tailAngle) * 10) * scale,
    (5 + Math.cos(tailAngle) * 8) * scale,
    (-22 + Math.sin(tailAngle) * 16) * scale,
    (-8 + Math.cos(tailAngle) * 12) * scale,
  );
  ctx.stroke();

  ctx.restore();
}

function drawDragon(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, tailAngle: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(0, 50 * scale, 20 * scale, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = '#059669';
  ctx.beginPath();
  ctx.ellipse(0, 20 * scale, 18 * scale, 20 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wing membranes (left/right, behind body)
  ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
  ctx.beginPath();
  ctx.moveTo(-16 * scale, 5 * scale);
  ctx.quadraticCurveTo(-36 * scale, -18 * scale, -28 * scale, 2 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(16 * scale, 5 * scale);
  ctx.quadraticCurveTo(36 * scale, -18 * scale, 28 * scale, 2 * scale);
  ctx.closePath();
  ctx.fill();

  // Head
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.arc(0, -10 * scale, 17 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Horns (golden)
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.moveTo(-8 * scale, -22 * scale);
  ctx.lineTo(-12 * scale, -40 * scale);
  ctx.lineTo(-4 * scale, -26 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8 * scale, -22 * scale);
  ctx.lineTo(12 * scale, -40 * scale);
  ctx.lineTo(4 * scale, -26 * scale);
  ctx.closePath();
  ctx.fill();

  // Eyes (slit pupils)
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.ellipse(-6 * scale, -12 * scale, 5 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(6 * scale, -12 * scale, 5 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(-6 * scale, -12 * scale, 1.5 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(6 * scale, -12 * scale, 1.5 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nostrils
  ctx.fillStyle = '#065f46';
  ctx.beginPath();
  ctx.arc(-3 * scale, -2 * scale, 2 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(3 * scale, -2 * scale, 2 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Spiky tail
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 4 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(14 * scale, 25 * scale);
  ctx.quadraticCurveTo(
    (22 + Math.sin(tailAngle) * 8) * scale,
    (10 + Math.cos(tailAngle) * 6) * scale,
    (20 + Math.sin(tailAngle) * 12) * scale,
    (-5 + Math.cos(tailAngle) * 10) * scale,
  );
  ctx.stroke();
  // Spiky tip
  ctx.fillStyle = '#f59e0b';
  const tipX = (20 + Math.sin(tailAngle) * 12) * scale;
  const tipY = (-5 + Math.cos(tailAngle) * 10) * scale;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY - 6 * scale);
  ctx.lineTo(tipX - 3 * scale, tipY + 4 * scale);
  ctx.lineTo(tipX + 3 * scale, tipY + 4 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ─── PetController ────────────────────────────────────────────────────────────

export class PetController {
  private _scene: Scene;
  private _petData: PetData;
  private _root: TransformNode;
  private _quad: AbstractMesh;
  private _dynTex: DynamicTexture;
  private _mat: StandardMaterial;
  private _labelGui: AdvancedDynamicTexture | null = null;
  private _billboardLabel: TextBlock | null = null;
  private _targetMesh: TransformNode | null = null;
  private _renderObserver: (() => void) | null = null;
  private _unsubStateUpdate: (() => void) | null = null;

  // AI state
  private _state: PetState = 'IDLE';
  private _stateTimer = 0;       // seconds in current state
  private _animTimer = 0;        // continuous animation clock (seconds)
  private _paintAccum = 0;       // throttles 2D canvas redraws (~20 FPS)
  private _wanderTarget: Vector3 | null = null;
  private _facing = 1;           // 1 = right, -1 = left (for horizontal flip)

  constructor(scene: Scene, petData: PetData, followTarget?: TransformNode) {
    this._scene = scene;
    this._petData = petData;
    this._targetMesh = followTarget || null;

    this._root = new TransformNode(`pet_root_${petData.id}`, scene);
    if (followTarget) {
      this._root.position = followTarget.position.clone().add(new Vector3(1.2, 0, 0.8));
    }

    // ── 2D Billboard quad ──────────────────────────────────────────────────
    this._quad = MeshBuilder.CreatePlane(
      `pet_quad_${petData.id}`,
      { width: QUAD_W, height: QUAD_H },
      scene,
    );
    this._quad.parent = this._root;
    this._quad.position.y = QUAD_H * 0.5 + 0.05;
    this._quad.billboardMode = AbstractMesh.BILLBOARDMODE_Y;

    // DynamicTexture for Canvas 2D art
    this._dynTex = new DynamicTexture(
      `pet_tex_${petData.id}`,
      { width: TEX_W, height: TEX_H },
      scene,
      true,
    );
    this._dynTex.hasAlpha = true;

    const mat = new StandardMaterial(`pet_mat_${petData.id}`, scene);
    mat.diffuseTexture = this._dynTex;
    mat.emissiveColor = Color3.White();
    mat.backFaceCulling = false;
    mat.useAlphaFromDiffuseTexture = true;
    this._quad.material = mat;
    this._mat = mat;

    this._buildLabel();
    this._paintFrame(0);          // initial render
    this._startLoop();
    this._listenToSocket();
  }

  // ── Name label billboard ────────────────────────────────────────────────────

  private _buildLabel(): void {
    const labelPlane = MeshBuilder.CreatePlane(
      `pet_label_${this._petData.id}`,
      { width: 2.0, height: 0.4 },
      this._scene,
    );
    labelPlane.parent = this._root;
    labelPlane.position.y = QUAD_H + 0.18;
    labelPlane.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;

    const gui = AdvancedDynamicTexture.CreateForMesh(labelPlane, 512, 96);
    this._labelGui = gui;
    const label = new TextBlock(`pet_label_text_${this._petData.id}`, this._getLabelText());
    label.color = '#ffffff';
    label.fontSize = 30;
    label.fontFamily = 'Calibri, sans-serif';
    label.outlineColor = '#000000';
    label.outlineWidth = 3;
    gui.addControl(label);
    this._billboardLabel = label;
  }

  private _getLabelText(): string {
    const emoji = this._petData.happiness > 70 ? '😊' : this._petData.happiness > 30 ? '😐' : '😢';
    const sleeping = this._state === 'SLEEP' ? ' 💤' : '';
    return `${this._petData.name} ${emoji}${sleeping}`;
  }

  // ── Canvas art render ───────────────────────────────────────────────────────

  private _paintFrame(dt: number): void {
    this._animTimer += dt;
    const t = this._animTimer;

    const ctx = this._dynTex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, TEX_W, TEX_H);

    // Breathing: gentle vertical scale oscillation
    const breathScale = this._state === 'SLEEP' ? 1.0 - 0.04 * Math.sin(t * 1.2) : 1.0 + 0.025 * Math.sin(t * 2.5);
    // Hop: raised Y offset during wander/follow
    const isHopping = this._state === 'WANDER' || this._state === 'FOLLOW';
    const hopY = isHopping ? -Math.abs(Math.sin(t * 8)) * 8 : 0;
    // Tail sway angle
    const tailAngle = t * (this._state === 'SLEEP' ? 0.4 : 2.2);

    const CX = TEX_W / 2;
    const CY = TEX_H / 2 + hopY;
    const S = 0.42 * breathScale;

    ctx.save();
    // Flip horizontally when facing left
    if (this._facing === -1) {
      ctx.scale(-1, 1);
      ctx.translate(-TEX_W, 0);
    }

    switch (this._petData.petType) {
      case 'CAT':
        drawCat(ctx, CX, CY, S, tailAngle);
        break;
      case 'DOG':
        drawDog(ctx, CX, CY, S, tailAngle);
        break;
      case 'BABY_DRAGON':
      default:
        drawDragon(ctx, CX, CY, S, tailAngle);
        break;
    }
    ctx.restore();

    this._dynTex.update(true);
  }

  // ── AI state machine + render loop ─────────────────────────────────────────

  private _startLoop(): void {
    this._renderObserver = () => {
      const rawDt = this._scene.getEngine().getDeltaTime();
      const dt = Math.min(rawDt / 1000, 0.1); // seconds, capped at 100ms
      this._tickAI(dt);
      this._paintAccum += dt;
      if (this._paintAccum >= 0.05) {
        this._paintFrame(this._paintAccum);
        this._paintAccum = 0;
      }
    };
    this._scene.registerBeforeRender(this._renderObserver);
  }

  private _tickAI(dt: number): void {
    this._stateTimer += dt;

    switch (this._state) {
      case 'IDLE': {
        // Transition: follow owner if close enough
        if (this._targetMesh) {
          const dist = Vector3.Distance(this._root.position, this._targetMesh.position);
          if (dist > FOLLOW_DISTANCE) {
            this._enterState('FOLLOW');
            return;
          }
        }
        if (this._stateTimer > IDLE_TO_SLEEP_SECS) {
          this._enterState('SLEEP');
        } else if (this._stateTimer > IDLE_TO_WANDER_SECS) {
          this._enterState('WANDER');
        }
        break;
      }

      case 'WANDER': {
        if (!this._wanderTarget) {
          this._pickWanderTarget();
        }
        if (this._wanderTarget) {
          const dir = this._wanderTarget.subtract(this._root.position);
          const dist = dir.length();
          if (dist < 0.15) {
            this._wanderTarget = null;
            if (this._stateTimer > WANDER_TO_IDLE_SECS) {
              this._enterState('IDLE');
            }
          } else {
            const normDir = dir.normalize();
            this._facing = normDir.x >= 0 ? 1 : -1;
            this._root.position.addInPlace(normDir.scale(WANDER_SPEED));
          }
        } else if (this._stateTimer > WANDER_TO_IDLE_SECS) {
          this._enterState('IDLE');
        }
        break;
      }

      case 'FOLLOW': {
        if (!this._targetMesh) {
          this._enterState('IDLE');
          return;
        }
        const targetPos = this._targetMesh.position;
        const petPos = this._root.position;
        const dist = Vector3.Distance(petPos, targetPos);
        if (dist <= FOLLOW_DISTANCE * 0.6) {
          this._enterState('IDLE');
        } else {
          const dir = targetPos.subtract(petPos).normalize();
          this._facing = dir.x >= 0 ? 1 : -1;
          this._root.position.addInPlace(dir.scale(FOLLOW_SPEED));
        }
        break;
      }

      case 'SLEEP': {
        // Wake up if owner moves close
        if (this._targetMesh) {
          const dist = Vector3.Distance(this._root.position, this._targetMesh.position);
          if (dist < FOLLOW_DISTANCE * 0.5) {
            this._enterState('IDLE');
          }
        }
        break;
      }

      case 'REACT': {
        // Return to IDLE after 2 seconds
        if (this._stateTimer > 2.0) {
          this._enterState('IDLE');
        }
        break;
      }
    }
  }

  private _enterState(newState: PetState): void {
    this._state = newState;
    this._stateTimer = 0;
    this._wanderTarget = null;
    if (this._billboardLabel) {
      this._billboardLabel.text = this._getLabelText();
    }
  }

  private _pickWanderTarget(): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * WANDER_RADIUS;
    this._wanderTarget = this._root.position.clone().add(
      new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
    );
  }

  /** Called externally (e.g. player clicks/pets the animal) to trigger REACT state. */
  public pet(): void {
    this._enterState('REACT');
  }

  // ── Socket listener ─────────────────────────────────────────────────────────

  private _listenToSocket(): void {
    this._unsubStateUpdate = socketService.on<{
      petId: string;
      position?: { x: number; y: number; z: number };
      state?: string;
    }>(SOCKET_EVENTS.PET_STATE_UPDATE, (data) => {
      if (data.petId !== this._petData.id) return;
      if (data.position) {
        this._root.position.set(data.position.x, data.position.y, data.position.z);
      }
    });
  }

  // ── Stats update ─────────────────────────────────────────────────────────────

  updateStats(happiness: number, hunger: number): void {
    this._petData.happiness = happiness;
    this._petData.hunger = hunger;
    if (this._billboardLabel) {
      this._billboardLabel.text = this._getLabelText();
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  dispose(): void {
    if (this._renderObserver) {
      this._scene.unregisterBeforeRender(this._renderObserver);
      this._renderObserver = null;
    }
    if (this._unsubStateUpdate) {
      this._unsubStateUpdate();
      this._unsubStateUpdate = null;
    }
    this._labelGui?.dispose();
    this._labelGui = null;
    this._mat.dispose();
    this._dynTex.dispose();
    this._root.dispose(false, true);
  }
}
