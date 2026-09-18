import * as BABYLON from '@babylonjs/core';
import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';

export class FishingController {
  private scene: BABYLON.Scene;
  private isFishing = false;
  private panel: HTMLElement | null = null;
  private tensionBar: HTMLElement | null = null;
  private sweetSpotEl: HTMLElement | null = null;
  private reelSlider: HTMLInputElement | null = null;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.setupSocketListeners();
  }

  startFishing(roomId: string): void {
    if (this.isFishing) return;
    this.isFishing = true;
    socketService.emit(SOCKET_EVENTS.CAST_LINE, { roomId });
    this.createUI();
  }

  cancelFishing(): void {
    if (!this.isFishing) return;
    this.isFishing = false;
    socketService.emit(SOCKET_EVENTS.CANCEL_FISHING, {});
    this.destroyUI();
  }

  private createUI(): void {
    this.destroyUI();

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
      z-index: 2000;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
      text-align: center;
    `;

    this.panel.innerHTML = `
      <div style="font-weight: bold; font-size: 1.1rem; color: #38bdf8; margin-bottom: 8px;">🎣 Fishing</div>
      <div id="fish-status" style="font-size: 0.9rem; color: #aaa; margin-bottom: 12px;">Waiting for a bite...</div>
      
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

    this.reelSlider?.addEventListener('input', () => {
      const val = parseFloat(this.reelSlider!.value) / 100;
      socketService.emit(SOCKET_EVENTS.REEL_POSITION, { value: val });
    });

    this.panel.querySelector('#btn-cancel-fishing')?.addEventListener('click', () => {
      this.cancelFishing();
    });
  }

  private destroyUI(): void {
    this.panel?.remove();
    this.panel = null;
  }

  private setupSocketListeners(): void {
    socketService.on<{ species: string; difficulty: string }>(
      SOCKET_EVENTS.FISH_BITE,
      (data) => {
        audioEngine.playFishingBite();
        const statusEl = document.getElementById('fish-status');
        if (statusEl) {
          statusEl.textContent = `A ${data.difficulty} ${data.species} took the bait! Reel it in!`;
          statusEl.style.color = '#f59e0b';
        }
      }
    );

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
    );

    socketService.on<{ species: string; weight: number; coins: number; isRare: boolean }>(
      SOCKET_EVENTS.FISH_CAUGHT,
      (data) => {
        audioEngine.playFishingCatch();
        audioEngine.playCoinPickup();
        alert(`🎉 You caught a ${data.species} (${data.weight} lbs)!\nEarned +${data.coins} HavenCoins!`);
        this.destroyUI();
        this.isFishing = false;
      }
    );

    socketService.on(SOCKET_EVENTS.FISH_ESCAPED, () => {
      alert('💨 The fish got away!');
      this.destroyUI();
      this.isFishing = false;
    });
  }

  dispose(): void {
    this.cancelFishing();
  }
}
