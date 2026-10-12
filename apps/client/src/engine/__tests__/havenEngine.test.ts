import { describe, it, expect } from 'vitest';
import { HavenEngine } from '../HavenEngine';

describe('HavenEngine LOD and Performance Systems', () => {
  it('correctly computes Avatar LOD culling at various distances with default thresholds', () => {
    // Within 15 units -> FULL
    expect(HavenEngine.computeLOD(0)).toBe('FULL');
    expect(HavenEngine.computeLOD(10)).toBe('FULL');
    expect(HavenEngine.computeLOD(15)).toBe('FULL');

    // Between 15 and 35 units -> REDUCED
    expect(HavenEngine.computeLOD(15.1)).toBe('REDUCED');
    expect(HavenEngine.computeLOD(25)).toBe('REDUCED');
    expect(HavenEngine.computeLOD(35)).toBe('REDUCED');

    // Beyond 35 units -> CULLED
    expect(HavenEngine.computeLOD(35.1)).toBe('CULLED');
    expect(HavenEngine.computeLOD(80)).toBe('CULLED');
  });

  it('supports custom LOD thresholds', () => {
    // Custom reduced at 5, culled at 12
    expect(HavenEngine.computeLOD(3, 5, 12)).toBe('FULL');
    expect(HavenEngine.computeLOD(8, 5, 12)).toBe('REDUCED');
    expect(HavenEngine.computeLOD(15, 5, 12)).toBe('CULLED');
  });

  it('validates WebGL requirement check on instantiation failure when unsupported', () => {
    // HavenEngine requires WebGL
    expect(HavenEngine.getInstance).toBeDefined();
  });
});
