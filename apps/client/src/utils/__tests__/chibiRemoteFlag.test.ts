import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { selectRemoteChibiAction, isChibiRemoteEnabled } from '../chibiRemoteFlag';

function setLocation(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { search },
    writable: true,
    configurable: true,
  });
}

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
  beforeEach(() => {
    localStorage.clear();
    setLocation('');
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('returns boolean', () => {
    expect(typeof isChibiRemoteEnabled()).toBe('boolean');
  });

  it('no param + no stored value -> enabled', () => {
    expect(isChibiRemoteEnabled()).toBe(true);
  });

  it("param '1' -> enabled", () => {
    setLocation('?chibiRemote=1');
    expect(isChibiRemoteEnabled()).toBe(true);
  });

  it("param '0' -> disabled", () => {
    setLocation('?chibiRemote=0');
    expect(isChibiRemoteEnabled()).toBe(false);
  });

  it("stored '0' -> disabled", () => {
    localStorage.setItem('chibiRemote', '0');
    expect(isChibiRemoteEnabled()).toBe(false);
  });

  it("stored '1' -> enabled", () => {
    localStorage.setItem('chibiRemote', '1');
    expect(isChibiRemoteEnabled()).toBe(true);
  });
});
