import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ChibiBillboard } from '../ChibiBillboard';
import { ChibiAtlasManager } from '../ChibiAtlasManager';

// Round 11 regression: bottom tint isolation.
//
// The blue-face bug: the pre-fix renderer applied the bottom layer's
// 'source-atop' tint fill directly on the MAIN texture context, after the
// body and eyes layers had already been drawn there — recoloring every
// opaque pixel on the face with the pants accent color. The fix tints the
// bottom frame on an OFFSCREEN canvas and composites it onto the main
// context with drawImage, so the main context never sees 'source-atop'.
//
// Why structural assertions: the unit-test environment has no working 2D
// canvas (getContext('2d') returns null), and render() returns early when
// the atlas image is missing — so an unstubbed render never reaches the
// bottom-layer branch at all. The atlas, the texture context, and
// document.createElement are therefore replaced with recording fakes, and
// the assertions are about WHICH context receives the tint operations:
//
//   buggy renderer -> 'source-atop' is assigned on the MAIN context and
//                     fillRect is called there (this test FAILS)
//   fixed renderer -> 'source-atop' appears only on a context belonging
//                     to a canvas from document.createElement, and the
//                     main context receives that canvas via drawImage
//                     (this test PASSES)

class RecordingContext {
  public gcoAssignments: string[] = [];
  public fillStyles: string[] = [];
  public fillRectCalls: number[][] = [];
  public drawImageSources: unknown[] = [];
  public imageSmoothingEnabled = false;
  public imageSmoothingQuality = 'low';
  private _gco = 'source-over';
  private _fillStyle = '#000000';

  set globalCompositeOperation(v: string) {
    this.gcoAssignments.push(v);
    this._gco = v;
  }
  get globalCompositeOperation(): string {
    return this._gco;
  }
  set fillStyle(v: string) {
    this.fillStyles.push(v);
    this._fillStyle = v;
  }
  get fillStyle(): string {
    return this._fillStyle;
  }

  save(): void {}
  restore(): void {}
  clearRect(): void {}
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRectCalls.push([x, y, w, h]);
  }
  drawImage(source: unknown): void {
    this.drawImageSources.push(source);
  }
}

interface FakeCanvas {
  canvas: HTMLCanvasElement;
  ctx: RecordingContext;
}

function makeFakeCanvas(): FakeCanvas {
  const ctx = new RecordingContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
}

describe('Round 11 regression: bottom tint isolation (discriminating structural test)', () => {
  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    scene.dispose();
    engine.dispose();
  });

  it('computes the denim bottom tint and runs the bottom-layer render branch', () => {
    const cb = new ChibiBillboard('test', scene);
    cb.setAvatarData({ outfitLegs: 'denim-jeans', bottomColor: '#2E8B57' } as any);
    expect(cb.bottomTint).toBe('#2C4C8C');
    expect(cb.isBottomLayerEnabled()).toBe(true);
    expect(() => cb.render()).not.toThrow();
    cb.dispose();
  });

  it('computes the olive bottom tint for olive-shorts', () => {
    const cb = new ChibiBillboard('test2', scene);
    cb.setAvatarData({ outfitLegs: 'olive-shorts', bottomColor: '#2E8B57' } as any);
    expect(cb.bottomTint).toBe('#556B2F');
    expect(cb.isBottomLayerEnabled()).toBe(true);
    expect(() => cb.render()).not.toThrow();
    cb.dispose();
  });

  it('applies source-atop only on an offscreen canvas, never on the main texture context', () => {
    // Fake atlas: an image is present and every layer resolves to a frame,
    // so render() actually reaches the bottom-layer branch. load() never
    // resolves, so the constructor's async initAtlas cannot fire a second,
    // uncontrolled render during the test.
    const fakeAtlas = {
      load: () => new Promise<void>(() => {}),
      getImage: () => ({}),
      resolveFrameKey: (layer: string) => layer,
      getFrame: () => ({ frame: { x: 0, y: 0, w: 32, h: 32 } }),
    };
    vi.spyOn(ChibiAtlasManager, 'getInstance').mockReturnValue(fakeAtlas as any);

    const cb = new ChibiBillboard('round11-structural', scene);

    // Recording main texture context, injected over the real one.
    const mainCtx = new RecordingContext();
    const tex = (cb as any).dynamicTexture;
    tex.getContext = () => mainCtx;
    tex.update = () => {};

    // Recording offscreen canvases handed out by document.createElement.
    const created: FakeCanvas[] = [];
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') {
        const fake = makeFakeCanvas();
        created.push(fake);
        return fake.canvas;
      }
      return realCreateElement(tag as any);
    }) as any);

    cb.setAvatarData({ outfitLegs: 'denim-jeans', bottomColor: '#2E8B57' } as any);

    expect(cb.bottomTint).toBe('#2C4C8C');

    // The bug, caught: on the buggy renderer the tint fill lands on the
    // main context, on top of the already-drawn face.
    expect(mainCtx.gcoAssignments).not.toContain('source-atop');
    expect(mainCtx.fillRectCalls).toHaveLength(0);

    // The fix, proven: exactly one offscreen canvas is created, the tint
    // is applied there with the denim accent color, and the finished
    // canvas is composited onto the main context.
    expect(created).toHaveLength(1);
    expect(created[0].ctx.gcoAssignments).toContain('source-atop');
    expect(created[0].ctx.fillStyles).toContain('#2C4C8C');
    expect(created[0].ctx.fillRectCalls.length).toBeGreaterThan(0);
    expect(mainCtx.drawImageSources).toContain(created[0].canvas);

    cb.dispose();
  });
});
