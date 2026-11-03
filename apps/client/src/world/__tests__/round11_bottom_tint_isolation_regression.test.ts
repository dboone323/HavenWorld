import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ChibiBillboard } from '../ChibiBillboard';

describe('Round 11 regression: bottom tint isolation', () => {
  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });

  afterEach(() => {
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
});
