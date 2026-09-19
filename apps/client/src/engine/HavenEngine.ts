import { Engine, Scene, HavokPlugin } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';

export class HavenEngine {
  private static _instance: HavenEngine | null = null;
  private _engine: Engine;
  private _canvas: HTMLCanvasElement;
  private _activeScene: Scene | null = null;
  private _inspectorLoaded = false;

  private _resizeObserver: ResizeObserver | null = null;

  private constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false,
    });

    // Support HiDPI / Retina displays up to 2x for crisp 1080p+ rendering
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this._engine.setHardwareScalingLevel(1 / dpr);

    // Start the render loop — renders whatever _activeScene is set to
    this._engine.runRenderLoop(() => {
      if (this._activeScene && this._activeScene.activeCamera) {
        this._activeScene.render();
      }
    });

    // Automatically resize whenever the canvas dimensions or container visibility changes
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
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

    console.log(`[HavenEngine] Babylon.js ${Engine.Version} initialized.`);
  }

  /** Singleton accessor. Call HavenEngine.getInstance() to get or create. */
  public static async getInstance(canvas?: HTMLCanvasElement): Promise<HavenEngine> {
    if (!HavenEngine._instance) {
      if (!canvas) {
        throw new Error('[HavenEngine] Canvas required for first initialization.');
      }
      HavenEngine._instance = new HavenEngine(canvas);
      await HavenEngine._instance._initPhysics();

      if (import.meta.env.DEV) {
        await HavenEngine._instance._loadInspector();
      }
    }
    return HavenEngine._instance;
  }

  /** Initialize Havok physics plugin and attach to global scope for scene use. */
  private async _initPhysics(): Promise<void> {
    try {
      const havokInstance = await HavokPhysics();
      const plugin = new HavokPlugin(true, havokInstance);
      (window as unknown as Record<string, unknown>).__havenHavokPlugin = plugin;
      console.log('[HavenEngine] Havok physics initialized.');
    } catch (err) {
      console.warn('[HavenEngine] Havok physics failed to load. Physics disabled.', err);
    }
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

  private _onResize = (): void => {
    this._engine.resize();
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
    this._activeScene?.dispose();
    this._engine.dispose();
    HavenEngine._instance = null;
    console.log('[HavenEngine] Disposed.');
  }
}
