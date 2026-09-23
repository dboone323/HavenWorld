export interface Vector2D {
  x: number;
  y: number;
}

export class SmoothCamera {
  public position: Vector2D;
  public target: Vector2D;
  public smoothing: number; // 0.05 to 0.2 typical lerp factor
  public deadzone: number;

  constructor(initialPosition: Vector2D = { x: 0, y: 0 }, smoothing: number = 0.08, deadzone: number = 0.01) {
    this.position = { ...initialPosition };
    this.target = { ...initialPosition };
    this.smoothing = smoothing;
    this.deadzone = deadzone;
  }

  setTarget(target: Vector2D): void {
    this.target = { ...target };
  }

  /**
   * Updates camera position towards target with spring-damper exponential interpolation
   */
  update(deltaFactor: number = 1.0): Vector2D {
    const dx = this.target.x - this.position.x;
    const dy = this.target.y - this.position.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= this.deadzone) {
      this.position.x = this.target.x;
      this.position.y = this.target.y;
      return { ...this.position };
    }

    const factor = Math.min(1.0, this.smoothing * deltaFactor);
    this.position.x += dx * factor;
    this.position.y += dy * factor;

    return { ...this.position };
  }

  snapToTarget(): void {
    this.position = { ...this.target };
  }
}
