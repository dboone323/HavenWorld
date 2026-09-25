import { assetUrl } from '../config';

export interface AtlasFrame {
  frame: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface AtlasMeta {
  image: string;
  format: string;
  size: { w: number; h: number };
}

export interface AtlasJson {
  frames: Record<string, AtlasFrame>;
  meta: AtlasMeta;
}

export class ChibiAtlasManager {
  private static instance: ChibiAtlasManager | null = null;
  private atlasData: AtlasJson | null = null;
  private atlasImage: HTMLImageElement | null = null;
  private loadPromise: Promise<void> | null = null;

  public static getInstance(): ChibiAtlasManager {
    if (!ChibiAtlasManager.instance) {
      ChibiAtlasManager.instance = new ChibiAtlasManager();
    }
    return ChibiAtlasManager.instance;
  }

  public async load(): Promise<void> {
    if (this.atlasData && this.atlasImage) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const jsonRes = await fetch(assetUrl('/assets/sprites/avatar/atlas.json'));
        if (!jsonRes.ok) {
          throw new Error(`Failed to load atlas.json: ${jsonRes.status}`);
        }
        this.atlasData = await jsonRes.json();

        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            this.atlasImage = img;
            resolve();
          };
          img.onerror = (err) => reject(new Error('Failed to load avatar atlas.png'));
          img.src = assetUrl('/assets/sprites/avatar/atlas.png');
        });
      } catch (err) {
        console.warn('[ChibiAtlasManager] Sprite atlas load fallback:', err);
      }
    })();

    return this.loadPromise;
  }

  public isLoaded(): boolean {
    return Boolean(this.atlasData && this.atlasImage);
  }

  public getFrame(key: string): AtlasFrame | undefined {
    return this.atlasData?.frames[key];
  }

  public getImage(): HTMLImageElement | null {
    return this.atlasImage;
  }

  public getAtlasMeta(): AtlasMeta | null {
    return this.atlasData?.meta || null;
  }

  /**
   * Resolves frame key based on layer, action ('idle' | 'walk' | 'sit'), direction ('down' | 'up' | 'left' | 'right'), and frame index.
   */
  public resolveFrameKey(
    layer: 'body' | 'eyes' | 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'shadow',
    action: 'idle' | 'walk' | 'sit',
    direction: 'down' | 'up' | 'left' | 'right',
    frameIndex: number = 0
  ): string {
    // When sitting, map to the stationary frame (or idle frame)
    const effectiveAction = action === 'sit' ? 'idle' : action;
    const maxFrames = effectiveAction === 'walk' ? 8 : 2;
    const safeIndex = (frameIndex % maxFrames).toString().padStart(2, '0');
    return `${layer}-${effectiveAction}-${direction}-${safeIndex}`;
  }
}
