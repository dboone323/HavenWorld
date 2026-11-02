import { describe, it, expect } from 'vitest';
import { selectRemoteChibiAction, isChibiRemoteEnabled } from '../chibiRemoteFlag';

describe('selectRemoteChibiAction', () => {
  it('idle when distance below threshold', () => {
    const r = selectRemoteChibiAction('down', 0.01, 0.01, 0.01);
    expect(r.isMoving).toBe(false);
    expect(r.direction).toBe('down');
  });
  it('walk right when horizontal dominates', () => {
    const r = selectRemoteChibiAction('down', 1, 0.1, 1.0);
    expect(r.isMoving).toBe(true);
    expect(r.direction).toBe('right');
  });
  it('walk left', () => {
    const r = selectRemoteChibiAction('down', -1, 0.1, 1.0);
    expect(r.direction).toBe('left');
  });
  it('walk up', () => {
    const r = selectRemoteChibiAction('down', 0.1, 1, 1.0);
    expect(r.direction).toBe('up');
  });
  it('walk down', () => {
    const r = selectRemoteChibiAction('right', 0.1, -1, 1.0);
    expect(r.direction).toBe('down');
  });
  it('retains previous direction in hysteresis band', () => {
    const r = selectRemoteChibiAction('up', 0.15, 0.1, 0.5);
    expect(r.isMoving).toBe(true);
    expect(r.direction).toBe('up');
  });
});

describe('isChibiRemoteEnabled', () => {
  it('returns boolean', () => {
    expect(typeof isChibiRemoteEnabled()).toBe('boolean');
  });
});
