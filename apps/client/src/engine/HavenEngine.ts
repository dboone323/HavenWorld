import { Engine, Scene } from '@babylonjs/core';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';

export type PerformanceQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'BATTERY_SAVER';
export type AvatarLOD = 'FULL' | 'REDUCED' | 'CULLED';

export interface PerformanceMetrics {
  dpr: number;
  quality: PerformanceQuality;
  targetFps: number;
  reducedThreshold: number;
  culledThreshold: number;
  isBackgroundThrottled: boolean;
}

export class HavenEngine {
  private static _instance: HavenEngine | null = null;
  private _engine: Engine;
  private _canvas: HTMLCanvasElement;
  private _activeScene: Scene | null = null;
  private _inspectorLoaded = false;

  private _quality: PerformanceQuality = 'HIGH';
  private _targetFps = 60;
  private _customDprScale: number | null = null;
  private _isBackgroundThrottled = false;
  private _reducedLODThreshold = 15;
  private _culledLODThreshold = 35;

  private _resizeObserver: ResizeObserver | null = null;

  private constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;

    // WebGL is a hard requirement: fail fast with a clear message instead of
    // throwing an opaque Babylon error later. The boot code in main.ts catches
    // this and renders the WebGL error screen (ui/WebGLError.ts).
    if (!Engine.IsSupported) {
      throw new Error(
        '[HavenEngine] WebGL is not supported by this browser. ' +
          'HavenWorld needs WebGL to render the 3D world — try a recent version of ' +
          'Chrome, Edge, Firefox, or Safari with hardware acceleration enabled.'
      );
    }

    this._engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false,
    });

    // Support HiDPI / Retina displays up to 2x for crisp 1080p+ rendering
    this._updateHardwareScaling();

    // Start the render loop — renders whatever _activeScene is set to
    this._engine.runRenderLoop(() => {
      if (this._activeScene && this._activeScene.activeCamera) {
        this._activeScene.render();
      }
    });

    // WebGL context loss (GPU reset, tab eviction, driver hiccup) used to
    // freeze the canvas with no feedback. Surface it to the UI: main.ts shows
    // a "graphics paused" overlay on loss and hides it on restore. Babylon
    // recreates GL resources automatically unless doNotHandleContextLost is set.
    this._engine.onContextLostObservable.add(() => {
      console.warn('[HavenEngine] WebGL context lost — rendering paused.');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('haven:webgl-context-lost'));
      }
    });
    this._engine.onContextRestoredObservable.add(() => {
      console.info('[HavenEngine] WebGL context restored — rendering resumed.');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('haven:webgl-context-restored'));
      }
    });

    // Automatically resize whenever the canvas dimensions or container visibility changes
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        this._updateHardwareScaling();
        this._engine.resize();
      });
      this._resizeObserver.observe(canvas);
      if (canvas.parentElement) {
        this._resizeObserver.observe(canvas.parentElement);
      }
    }

    // Resize handler
    window.addEventListener('resize', this._onResize);
    // Cleanup on unload
    window.addEventListener('beforeunload', this._onUnload);
    // Document visibility listener for background tab GPU throttling
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    console.log(`[HavenEngine] Babylon.js ${Engine.Version} initialized.`);
  }

  /** Singleton accessor. Call HavenEngine.getInstance() to get or create. */
  public static async getInstance(canvas?: HTMLCanvasElement): Promise<HavenEngine> {
    if (!HavenEngine._instance) {
      if (!canvas) {
        throw new Error('[HavenEngine] Canvas required for first initialization.');
      }
      HavenEngine._instance = new HavenEngine(canvas);

      if (import.meta.env.DEV) {
        await HavenEngine._instance._loadInspector();
      }
    }
    return HavenEngine._instance;
  }

  /** Dynamically import the Inspector in dev mode only — excluded from prod bundle. */
  private async _loadInspector(): Promise<void> {
    if (this._inspectorLoaded) return;
    try {
      await import('@babylonjs/inspector');
      this._inspectorLoaded = true;
      console.log('[HavenEngine] Inspector loaded. Press Ctrl+I (or Cmd+I) to toggle.');
    } catch (err) {
      console.warn('[HavenEngine] Inspector could not be loaded:', err);
    }
  }

  /** Toggle Babylon Inspector visibility. Only works in dev (inspector must be loaded). */
  public toggleInspector(): void {
    if (!this._activeScene) return;
    if (this._activeScene.debugLayer.isVisible()) {
      this._activeScene.debugLayer.hide();
    } else {
      this._activeScene.debugLayer.show({ embedMode: true });
    }
  }

  /** Set the active scene to be rendered each frame. */
  public setActiveScene(scene: Scene): void {
    this._activeScene = scene;
  }

  public get engine(): Engine {
    return this._engine;
  }

  public get canvas(): HTMLCanvasElement {
    return this._canvas;
  }

  public get activeScene(): Scene | null {
    return this._activeScene;
  }

  // ── Performance Quality & DPR Scaling ──────────────────────────────────────
  public setQuality(quality: PerformanceQuality): void {
    this._quality = quality;
    const baseDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    switch (quality) {
      case 'HIGH':
        this._targetFps = 60;
        this._customDprScale = Math.min(baseDpr, 2.0);
        this.setLODThresholds(20, 45);
        break;
      case 'MEDIUM':
        this._targetFps = 60;
        this._customDprScale = Math.min(baseDpr, 1.25);
        this.setLODThresholds(15, 30);
        break;
      case 'LOW':
        this._targetFps = 30;
        this._customDprScale = Math.min(baseDpr, 1.0);
        this.setLODThresholds(10, 20);
        break;
      case 'BATTERY_SAVER':
        this._targetFps = 30;
        this._customDprScale = Math.min(baseDpr, 0.75);
        this.setLODThresholds(8, 15);
        break;
    }
    this._updateHardwareScaling();
  }

  public setDprScale(scale: number): void {
    this._customDprScale = Math.max(0.5, Math.min(2.5, scale));
    this._updateHardwareScaling();
  }

  public getDprScale(): number {
    if (this._customDprScale !== null) return this._customDprScale;
    const baseDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return Math.min(baseDpr, 2);
  }

  public setTargetFps(fps: number): void {
    this._targetFps = Math.max(15, Math.min(120, fps));
  }

  public setLODThresholds(reducedDistance: number, culledDistance: number): void {
    this._reducedLODThreshold = Math.max(1, reducedDistance);
    this._culledLODThreshold = Math.max(this._reducedLODThreshold, culledDistance);
  }

  public computeAvatarLOD(distance: number): AvatarLOD {
    return HavenEngine.computeLOD(distance, this._reducedLODThreshold, this._culledLODThreshold);
  }

  public static computeLOD(distance: number, reducedThreshold = 15, culledThreshold = 35): AvatarLOD {
    if (distance > culledThreshold) return 'CULLED';
    if (distance > reducedThreshold) return 'REDUCED';
    return 'FULL';
  }

  public getPerformanceMetrics(): PerformanceMetrics {
    return {
      dpr: this.getDprScale(),
      quality: this._quality,
      targetFps: this._targetFps,
      reducedThreshold: this._reducedLODThreshold,
      culledThreshold: this._culledLODThreshold,
      isBackgroundThrottled: this._isBackgroundThrottled,
    };
  }

  private _updateHardwareScaling(): void {
    const dpr = this.getDprScale();
    this._engine.setHardwareScalingLevel(1 / dpr);
  }

  private _onResize = (): void => {
    this._updateHardwareScaling();
    this._engine.resize();
  };

  private _onVisibilityChange = (): void => {
    if (typeof document !== 'undefined') {
      this._isBackgroundThrottled = document.hidden;
      if (document.hidden) {
        // Throttle hardware scaling in background tab to preserve battery & memory
        this._engine.setHardwareScalingLevel(2.0); // 0.5x resolution
      } else {
        this._updateHardwareScaling();
        // Foreground resume: Check WebSocket connectivity and dispatch resume event
        if (!socketService.connected && authService.isLoggedIn) {
          console.info('[HavenEngine] Resuming from background: Reconnecting socket...');
          socketService.connect();
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('haven:app-resume'));
        }
      }
    }
  };

  private _onUnload = (): void => {
    this.dispose();
  };

  public dispose(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('beforeunload', this._onUnload);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    this._activeScene?.dispose();
    this._engine.dispose();
    HavenEngine._instance = null;
    console.log('[HavenEngine] Disposed.');
  }
}
