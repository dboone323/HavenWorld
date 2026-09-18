import { Scene } from '@babylonjs/core';
import { HavenEngine } from './HavenEngine';

type SceneFactory = (engine: HavenEngine, data?: any) => Promise<Scene>;

export class SceneManager {
  private static _instance: SceneManager | null = null;
  private _registry: Map<string, SceneFactory> = new Map();
  private _currentSceneName: string | null = null;
  private _currentScene: Scene | null = null;

  private constructor() {}

  public static getInstance(): SceneManager {
    if (!SceneManager._instance) {
      SceneManager._instance = new SceneManager();
    }
    return SceneManager._instance;
  }

  /**
   * Register a named scene factory function.
   * The factory receives the HavenEngine instance and returns a fully-initialized Scene.
   */
  public register(name: string, factory: SceneFactory): void {
    this._registry.set(name, factory);
    console.log(`[SceneManager] Registered scene: "${name}"`);
  }

  /**
   * Switch to a named scene. Disposes the current scene first, then
   * runs the factory, sets the new scene active on the engine, and returns it.
   */
  public async switchTo(name: string, data?: any): Promise<Scene> {
    const factory = this._registry.get(name);
    if (!factory) {
      throw new Error(`[SceneManager] Unknown scene: "${name}"`);
    }

    // Dispose old scene
    if (this._currentScene) {
      console.log(`[SceneManager] Disposing scene: "${this._currentSceneName}"`);
      this._currentScene.dispose();
      this._currentScene = null;
    }

    const haven = await HavenEngine.getInstance();
    console.log(`[SceneManager] Loading scene: "${name}"`);
    const scene = await factory(haven, data);
    haven.setActiveScene(scene);
    this._currentScene = scene;
    this._currentSceneName = name;
    console.log(`[SceneManager] Active scene: "${name}"`);
    return scene;
  }

  public get currentSceneName(): string | null {
    return this._currentSceneName;
  }

  public get currentScene(): Scene | null {
    return this._currentScene;
  }
}
