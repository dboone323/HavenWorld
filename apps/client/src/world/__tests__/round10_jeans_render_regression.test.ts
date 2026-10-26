import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ChibiBillboard } from '../ChibiBillboard';

describe('Round 10 regression: in-world bottom uses equipped item tint', () => {
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

  it('sets bottomTint to denim blue for denim-jeans', () => {
    const cb = new ChibiBillboard('test', scene);
    cb.setAvatarData({ outfitLegs: 'denim-jeans', bottomColor: '#2E8B57' } as any);
    cb.render();
    expect(cb.bottomTint).toBe('#2C4C8C');
    cb.dispose();
  });

  it('sets bottomTint to olive for olive-shorts', () => {
    const cb = new ChibiBillboard('test2', scene);
    cb.setAvatarData({ outfitLegs: 'olive-shorts', bottomColor: '#2E8B57' } as any);
    cb.render();
    expect(cb.bottomTint).toBe('#556B2F');
    cb.dispose();
  });
});
