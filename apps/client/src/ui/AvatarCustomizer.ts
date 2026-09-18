import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';
import type { AvatarData } from '@havenworld/shared';
import { AvatarController } from '../world/AvatarController';
import { authService } from '../services/auth';

// Skin tone presets (12 swatches)
const SKIN_TONES = [
  '#FDDBB4',
  '#F5CBA7',
  '#EAB88A',
  '#D4956A',
  '#C07A50',
  '#A0522D',
  '#8B4513',
  '#6B3410',
  '#4A2011',
  '#FDECDC',
  '#F2D7C0',
  '#E8C4A0',
];

// Hair color presets (24 swatches)
const HAIR_COLORS = [
  '#1C1C1C',
  '#3B2314',
  '#5C3317',
  '#7B4B2A',
  '#A0522D',
  '#C68642',
  '#D2A679',
  '#E8C49A',
  '#F5DEB3',
  '#FAF0E6',
  '#B22222',
  '#8B0000',
  '#FF4500',
  '#FF8C00',
  '#FFD700',
  '#808000',
  '#2E8B57',
  '#006400',
  '#4169E1',
  '#00008B',
  '#8B008B',
  '#4B0082',
  '#808080',
  '#FFFFFF',
];

// Eye color presets (8 swatches)
const EYE_COLORS = [
  '#4A3728',
  '#2D1B0E',
  '#5C7A29',
  '#2E8B57',
  '#4169E1',
  '#1E3A8A',
  '#708090',
  '#C0C0C0',
];

export class AvatarCustomizer {
  private overlay: HTMLElement | null = null;
  private previewController: AvatarController | null = null;
  private previewEngine: BABYLON.Engine | null = null;
  private previewScene: BABYLON.Scene | null = null;
  private currentData: AvatarData;
  private savedData: AvatarData;
  private onSaveCallback: (data: AvatarData) => void;

  constructor(savedData?: AvatarData, onSave?: (data: AvatarData) => void) {
    const userAvatar = authService.user?.avatar || {};
    const initial: AvatarData = {
      bodyType: 0.5,
      height: 0.5,
      build: 0.5,
      skinTone: '#F5CBA7',
      hairColor: '#1C1C1C',
      eyeColor: '#4A3728',
      topColor: '#4169E1',
      bottomColor: '#2E8B57',
      ...userAvatar,
      ...savedData,
    };

    this.savedData = { ...initial };
    this.currentData = { ...initial };
    this.onSaveCallback = onSave || (() => {});
  }

  open(): void {
    if (this.overlay) return; // already open
    const userAvatar = authService.user?.avatar || {};
    this.currentData = { ...this.currentData, ...userAvatar };
    this.savedData = { ...this.currentData };
    this.overlay = this.buildOverlay();
    document.body.appendChild(this.overlay);
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.previewController?.dispose();
    this.previewController = null;
    this.previewScene?.dispose();
    this.previewScene = null;
    this.previewEngine?.dispose();
    this.previewEngine = null;
  }

  // ─── UI Builder ───────────────────────────────────────────────────────────
  private buildOverlay(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'avatar-customizer';
    el.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: Calibri, sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a1a2e;
      border: 1px solid #4ecdc4;
      border-radius: 12px;
      color: #e0e0e0;
      width: min(840px, 94vw);
      max-height: 90vh;
      display: flex;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.8);
    `;

    panel.appendChild(this.buildPreviewPanel());
    panel.appendChild(this.buildControlPanel());
    el.appendChild(panel);
    return el;
  }

  private buildPreviewPanel(): HTMLElement {
    const div = document.createElement('div');
    div.style.cssText = 'width: 320px; background: #0f0f23; position: relative; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; border-right: 1px solid #2a2a4a;';

    const canvas = document.createElement('canvas');
    canvas.id = 'avatar-preview-canvas';
    canvas.style.cssText = 'width: 300px; height: 440px; display: block; outline: none; border-radius: 8px;';
    div.appendChild(canvas);

    const label = document.createElement('p');
    label.textContent = '3D Live Preview (drag to rotate)';
    label.style.cssText = 'text-align: center; color: #888; font-size: 9.5pt; margin: 8px 0;';
    div.appendChild(label);

    setTimeout(() => this.initPreviewScene(canvas), 100);
    return div;
  }

  private async initPreviewScene(canvas: HTMLCanvasElement): Promise<void> {
    try {
      const engine = new BABYLON.Engine(canvas, true);
      this.previewEngine = engine;

      const scene = new BABYLON.Scene(engine);
      this.previewScene = scene;
      scene.clearColor = new BABYLON.Color4(0.06, 0.06, 0.14, 1);

      const cam = new BABYLON.ArcRotateCamera(
        'previewCam',
        -Math.PI / 2,
        Math.PI / 2.3,
        3.5,
        new BABYLON.Vector3(0, 1.2, 0),
        scene
      );
      cam.lowerRadiusLimit = 2;
      cam.upperRadiusLimit = 5;
      cam.attachControl(canvas, true);

      const hemi = new BABYLON.HemisphericLight('previewHemi', new BABYLON.Vector3(0, 1, 0), scene);
      hemi.intensity = 0.8;

      const dir = new BABYLON.DirectionalLight('previewDir', new BABYLON.Vector3(-1, -2, -1), scene);
      dir.position = new BABYLON.Vector3(5, 10, 5);
      dir.intensity = 0.8;

      this.previewController = new AvatarController(scene, {
        id: 'preview',
        username: authService.user?.username || 'You',
        avatarData: this.currentData,
      });

      await this.previewController.load(BABYLON.Vector3.Zero());
      this.previewController.applyCustomization(this.currentData);

      engine.runRenderLoop(() => scene.render());
      window.addEventListener('resize', () => engine.resize());
    } catch (err) {
      console.error('[AvatarCustomizer] Preview init failed:', err);
    }
  }

  private buildControlPanel(): HTMLElement {
    const div = document.createElement('div');
    div.style.cssText = 'flex: 1; overflow-y: auto; padding: 24px;';
    div.innerHTML = '<h2 style="margin-top: 0; color: #4ecdc4; font-size: 16pt;">Wardrobe &amp; Customization</h2>';

    // Body Shape
    div.appendChild(
      this.buildSection('Body Shape', [
        this.buildSlider('Body Type', 'bodyType', 'Thin', 'Fat'),
        this.buildSlider('Height', 'height', 'Short', 'Tall'),
        this.buildSlider('Build', 'build', 'Slim', 'Muscular'),
      ])
    );

    // Colors
    div.appendChild(
      this.buildSection('Colors', [
        this.buildSwatchPicker('Skin Tone', 'skinTone', SKIN_TONES, true),
        this.buildSwatchPicker('Hair Color', 'hairColor', HAIR_COLORS, true),
        this.buildSwatchPicker('Eye Color', 'eyeColor', EYE_COLORS, false),
      ])
    );

    // Clothing Colors
    div.appendChild(
      this.buildSection('Clothing Colors', [
        this.buildColorInput('Top Color', 'topColor'),
        this.buildColorInput('Bottom Color', 'bottomColor'),
        this.buildNote('Full clothing items and accessories arrive in Phase 3.'),
      ])
    );

    // Action Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin-top: 24px; display: flex; gap: 12px;';

    const saveBtn = this.buildButton('Save', '#4ecdc4', '#0d0d1a', async () => {
      try {
        await this.persistToServer();
        this.savedData = { ...this.currentData };
        this.onSaveCallback(this.currentData);
        this.close();
      } catch (err) {
        console.error('[AvatarCustomizer] Save failed:', err);
        alert('Failed to save avatar customization.');
      }
    });

    const cancelBtn = this.buildButton('Cancel', 'transparent', '#e0e0e0', () => {
      this.currentData = { ...this.savedData };
      this.close();
    });
    cancelBtn.style.border = '1px solid #444';

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    div.appendChild(btnRow);

    return div;
  }

  // ─── Control Builders ─────────────────────────────────────────────────────
  private buildSection(title: string, children: HTMLElement[]): HTMLElement {
    const sec = document.createElement('div');
    sec.style.cssText = 'margin-bottom: 20px; border-bottom: 1px solid #2a2a4a; padding-bottom: 16px;';
    const h = document.createElement('h3');
    h.textContent = title;
    h.style.cssText = 'color: #7eb8f7; font-size: 11pt; margin-bottom: 10px;';
    sec.appendChild(h);
    children.forEach((c) => sec.appendChild(c));
    return sec;
  }

  private buildSlider(label: string, key: keyof AvatarData, minLabel: string, maxLabel: string): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 12px;';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'display: block; font-size: 10pt; margin-bottom: 4px; color: #ccc;';

    const controlRow = document.createElement('div');
    controlRow.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 9pt; color: #888;';

    const minSpan = document.createElement('span');
    minSpan.textContent = minLabel;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(Math.round(((this.currentData[key] as number) ?? 0.5) * 100));
    input.style.cssText = 'flex: 1; accent-color: #4ecdc4;';

    input.addEventListener('input', () => {
      (this.currentData[key] as number) = parseInt(input.value) / 100;
      this.previewController?.applyCustomization(this.currentData);
    });

    const maxSpan = document.createElement('span');
    maxSpan.textContent = maxLabel;

    controlRow.appendChild(minSpan);
    controlRow.appendChild(input);
    controlRow.appendChild(maxSpan);
    row.appendChild(lbl);
    row.appendChild(controlRow);
    return row;
  }

  private buildSwatchPicker(label: string, key: keyof AvatarData, swatches: string[], showCustom: boolean): HTMLElement {
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom: 14px;';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'display: block; font-size: 10pt; margin-bottom: 6px; color: #ccc;';
    div.appendChild(lbl);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center;';

    swatches.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.style.cssText = `
        width: 24px;
        height: 24px;
        background: ${color};
        border: 2px solid ${this.currentData[key] === color ? '#ffffff' : 'transparent'};
        border-radius: 4px;
        cursor: pointer;
        padding: 0;
      `;
      swatch.title = color;

      swatch.addEventListener('click', () => {
        (this.currentData[key] as string) = color;
        grid.querySelectorAll('button').forEach((b) => (b.style.borderColor = 'transparent'));
        swatch.style.borderColor = '#ffffff';
        this.previewController?.applyCustomization(this.currentData);
      });
      grid.appendChild(swatch);
    });

    if (showCustom) {
      const customInput = document.createElement('input');
      customInput.type = 'color';
      customInput.value = (this.currentData[key] as string) || '#F5CBA7';
      customInput.style.cssText = 'width: 26px; height: 26px; padding: 0; border: 1px solid #444; border-radius: 4px; cursor: pointer;';
      customInput.title = 'Custom Color';
      customInput.addEventListener('input', () => {
        (this.currentData[key] as string) = customInput.value;
        grid.querySelectorAll('button').forEach((b) => (b.style.borderColor = 'transparent'));
        this.previewController?.applyCustomization(this.currentData);
      });
      grid.appendChild(customInput);
    }

    div.appendChild(grid);
    return div;
  }

  private buildColorInput(label: string, key: keyof AvatarData): HTMLElement {
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom: 10px; display: flex; align-items: center; gap: 10px;';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size: 10pt; flex: 1; color: #ccc;';

    const input = document.createElement('input');
    input.type = 'color';
    input.value = (this.currentData[key] as string) || '#4169E1';
    input.style.cssText = 'width: 36px; height: 28px; padding: 0; border: 1px solid #444; border-radius: 4px; cursor: pointer;';
    input.addEventListener('input', () => {
      (this.currentData[key] as string) = input.value;
      this.previewController?.applyCustomization(this.currentData);
    });

    div.appendChild(lbl);
    div.appendChild(input);
    return div;
  }

  private buildNote(text: string): HTMLElement {
    const p = document.createElement('p');
    p.textContent = text;
    p.style.cssText = 'color: #888; font-size: 9pt; font-style: italic; margin: 4px 0 0 0;';
    return p;
  }

  private buildButton(text: string, bg: string, color: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `
      background: ${bg};
      color: ${color};
      border: none;
      border-radius: 6px;
      padding: 9px 24px;
      font-weight: 600;
      font-size: 10.5pt;
      cursor: pointer;
      transition: opacity 150ms;
    `;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ─── Server Persistence ───────────────────────────────────────────────────
  private async persistToServer(): Promise<void> {
    const SERVER =
      import.meta.env.VITE_SERVER_URL ||
      (import.meta.env.PROD ? 'https://147-224-164-228.nip.io' : '');
    const token = authService.token || authService.getToken() || '';

    const res = await fetch(`${SERVER}/api/users/me/avatar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify(this.currentData),
    });

    if (!res.ok) {
      throw new Error(`Failed to save avatar: ${res.status} ${res.statusText}`);
    }

    authService.updateAvatar({ ...this.currentData });
  }
}
