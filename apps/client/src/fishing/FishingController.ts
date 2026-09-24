import * as BABYLON from '@babylonjs/core';
import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';
import { showToast } from '../ui/ToastNotification';

/**
 * z-index for the fishing HUD. Modal overlays (shop, passport, trade,
 * daily-login) and the toast container all sit at 9999, so the fishing HUD
 * must render above them to stay visible and clickable.
 */
const FISHING_HUD_Z_INDEX = 12000;

/** If the server never answers our cast within this long, fail loudly. */
const BITE_TIMEOUT_MS = 15_000;
/** Keep slider traffic below the socket rate limiter while preserving responsiveness. */
const REEL_EMIT_INTERVAL_MS = 100;

export class FishingController {
  private scene: BABYLON.Scene;
  private isFishing = false;
  private panel: HTMLElement | null = null;
  private tensionBar: HTMLElement | null = null;
  private sweetSpotEl: HTMLElement | null = null;
  private reelSlider: HTMLInputElement | null = null;

  /** Unsubscribe fns for every socket listener registered in setupSocketListeners. */
  private socketUnsubs: Array<() => void> = [];
  /** Aborts the DOM listeners bound to the HUD when it is destroyed. */
  private uiAbort: AbortController | null = null;
  /** Fires when the server never responds to a cast. */
  private biteTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastReelEmitAt = 0;
  private pendingReelValue: number | null = null;
  private reelEmitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.setupSocketListeners();
  }

  startFishing(roomId: string): void {
    if (this.isFishing) return;
    this.isFishing = true;
    // Immediate feedback — never leave the player wondering if the click worked.
    showToast({ icon: '🎣', title: 'Casting…', subtitle: 'Waiting for a bite…' });
    socketService.emit(SOCKET_EVENTS.CAST_LINE, { roomId });
    this.createUI();
    this.armBiteTimeout();
  }

  cancelFishing(): void {
    if (!this.isFishing) return;
    this.endSession();
    socketService.emit(SOCKET_EVENTS.CANCEL_FISHING, {});
  }

  private createUI(): void {
    this.destroyUI();

    this.uiAbort = new AbortController();
    const { signal } = this.uiAbort;

    this.panel = document.createElement('div');
    this.panel.id = 'fishing-hud';
    this.panel.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      width: 320px;
      background: rgba(15, 23, 42, 0.92);
      border: 2px solid #38bdf8;
      border-radius: 12px;
      padding: 16px;
      color: #fff;
      font-family: Calibri, sans-serif;
      z-index: ${FISHING_HUD_Z_INDEX};
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
      text-align: center;
    `;

    this.panel.innerHTML = `
      <div style="font-weight: bold; font-size: 1.1rem; color: #38bdf8; margin-bottom: 8px;">🎣 Fishing</div>
      <div id="fish-status" style="font-size: 0.9rem; color: #aaa; margin-bottom: 12px;">Casting…</div>

      <!-- Tension Meter Track -->
      <div style="position: relative; width: 100%; height: 24px; background: #1e293b; border-radius: 6px; overflow: hidden; margin-bottom: 12px; border: 1px solid #475569;">
        <!-- Sweet Spot -->
        <div id="fishing-sweet-spot" style="position: absolute; top: 0; bottom: 0; left: 35%; width: 30%; background: rgba(56, 189, 248, 0.4); border-left: 2px solid #38bdf8; border-right: 2px solid #38bdf8;"></div>
        <!-- Tension Fill -->
        <div id="fishing-tension-fill" style="position: absolute; top: 0; bottom: 0; left: 0; width: 35%; background: linear-gradient(90deg, #22c55e, #eab308, #ef4444); transition: width 80ms linear;"></div>
      </div>

      <!-- Reel Slider -->
      <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 4px;">Hold Position in Sweet Spot</label>
      <input id="fishing-reel-slider" type="range" min="0" max="100" value="50" style="width: 100%; accent-color: #38bdf8; cursor: pointer;" />

      <button id="btn-cancel-fishing" style="margin-top: 12px; background: transparent; border: 1px solid #64748b; color: #cbd5e1; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 0.8rem;">Cancel</button>
    `;

    document.body.appendChild(this.panel);

    this.tensionBar = this.panel.querySelector('#fishing-tension-fill');
    this.sweetSpotEl = this.panel.querySelector('#fishing-sweet-spot');
    this.reelSlider = this.panel.querySelector('#fishing-reel-slider');

    this.reelSlider?.addEventListener(
      'input',
      () => {
        this.queueReelPosition(parseFloat(this.reelSlider!.value) / 100);
      },
      { signal }
    );

    this.panel
      .querySelector('#btn-cancel-fishing')
      ?.addEventListener('click', () => this.cancelFishing(), { signal });
  }

  private queueReelPosition(value: number): void {
    if (!Number.isFinite(value)) return;
    this.pendingReelValue = Math.min(1, Math.max(0, value));

    const elapsed = Date.now() - this.lastReelEmitAt;
    if (elapsed >= REEL_EMIT_INTERVAL_MS) {
      this.flushReelPosition();
      return;
    }

    if (this.reelEmitTimer) return;
    this.reelEmitTimer = setTimeout(() => {
      this.reelEmitTimer = null;
      this.flushReelPosition();
    }, REEL_EMIT_INTERVAL_MS - elapsed);
  }

  private flushReelPosition(): void {
    if (this.pendingReelValue === null) return;
    const value = this.pendingReelValue;
    this.pendingReelValue = null;
    this.lastReelEmitAt = Date.now();
    socketService.emit(SOCKET_EVENTS.REEL_POSITION, { value });
  }

  private clearReelTimer(): void {
    if (this.reelEmitTimer) {
      clearTimeout(this.reelEmitTimer);
      this.reelEmitTimer = null;
    }
    this.pendingReelValue = null;
  }

  private destroyUI(): void {
    this.clearReelTimer();
    this.uiAbort?.abort();
    this.uiAbort = null;
    this.panel?.remove();
    this.panel = null;
    this.tensionBar = null;
    this.sweetSpotEl = null;
    this.reelSlider = null;
  }

  private armBiteTimeout(): void {
    this.clearBiteTimeout();
    this.biteTimeout = setTimeout(() => {
      this.biteTimeout = null;
      if (!this.isFishing) return;
      console.warn('[Fishing] No bite received within 15s — ending session');
      this.endSession();
      showToast({
        icon: '🎣',
        title: 'No bite — try again',
        subtitle: 'The server never responded to your cast.',
      });
    }, BITE_TIMEOUT_MS);
  }

  private clearBiteTimeout(): void {
    if (this.biteTimeout) {
      clearTimeout(this.biteTimeout);
      this.biteTimeout = null;
    }
  }

  /**
   * Resets controller state and tears down the HUD without emitting
   * anything to the server. Callers that intend to cancel send
   * CANCEL_FISHING themselves.
   */
  private endSession(): void {
    this.isFishing = false;
    this.clearBiteTimeout();
    this.destroyUI();
  }

  private setupSocketListeners(): void {
    this.socketUnsubs.push(
      socketService.on<{ species: string; difficulty: string }>(
        SOCKET_EVENTS.FISH_BITE,
        (data) => {
          this.clearBiteTimeout();
          audioEngine.playFishingBite();
          showToast({
            icon: '🐟',
            title: 'Fish on!',
            subtitle: `A ${data.difficulty} ${data.species} took the bait — reel it in!`,
          });
          const statusEl = document.getElementById('fish-status');
          if (statusEl) {
            statusEl.textContent = `A ${data.difficulty} ${data.species} took the bait! Reel it in!`;
            statusEl.style.color = '#f59e0b';
          }
        }
      )
    );

    this.socketUnsubs.push(
      socketService.on<{ value: number; sweetSpotMin: number; sweetSpotMax: number }>(
        SOCKET_EVENTS.TENSION_UPDATE,
        (data) => {
          if (this.tensionBar) {
            this.tensionBar.style.width = `${Math.round(data.value * 100)}%`;
          }
          if (this.sweetSpotEl) {
            const leftPct = Math.round(data.sweetSpotMin * 100);
            const widthPct = Math.round((data.sweetSpotMax - data.sweetSpotMin) * 100);
            this.sweetSpotEl.style.left = `${leftPct}%`;
            this.sweetSpotEl.style.width = `${widthPct}%`;
          }
        }
      )
    );

    this.socketUnsubs.push(
      socketService.on<{ species: string; weight: number; coins: number; isRare: boolean }>(
        SOCKET_EVENTS.FISH_CAUGHT,
        (data) => {
          audioEngine.playFishingCatch();
          audioEngine.playCoinPickup();
          this.endSession();
          showToast({
            icon: '🎉',
            title: `Caught a ${data.species} (${data.weight} lbs)!`,
            subtitle: `Earned +${data.coins} HavenCoins!`,
          });
        }
      )
    );

    this.socketUnsubs.push(
      socketService.on(SOCKET_EVENTS.FISH_ESCAPED, () => {
        this.endSession();
        showToast({
          icon: '💨',
          title: 'The fish got away!',
          subtitle: 'Cast again to try your luck.',
        });
      })
    );

    this.socketUnsubs.push(
      socketService.on<{ code?: string; message?: string }>(
        SOCKET_EVENTS.ERROR,
        (data) => {
          if (!this.isFishing) return;
          console.warn('[Fishing] server error:', data);
          this.endSession();
          showToast({
            icon: '⚠️',
            title: 'Fishing error',
            subtitle: data?.message || data?.code || 'Something went wrong. Try again.',
          });
        }
      )
    );
  }

  dispose(): void {
    if (this.isFishing) {
      socketService.emit(SOCKET_EVENTS.CANCEL_FISHING, {});
    }
    this.endSession();
    for (const unsub of this.socketUnsubs) {
      unsub();
    }
    this.socketUnsubs = [];
  }
}
