import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ChibiBillboard } from '../ChibiBillboard';

describe('Round 6 regression: jeans bottom renders', () => {
  it('enables bottom layer for denim-jeans with legacy bottom none', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cb = new ChibiBillboard('test', scene);
    cb.setAvatarData({ outfitLegs: 'denim-jeans', bottom: 'none' } as any);
    expect(cb.isBottomLayerEnabled()).toBe(true);
    cb.dispose();
    scene.dispose();
    engine.dispose();
  });
});
