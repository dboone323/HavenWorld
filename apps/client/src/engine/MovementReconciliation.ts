export interface PredictedMove {
  seq: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  timestamp: number;
}

export class MovementReconciliation {
  private nextSeq: number = 1;
  private pendingMoves: PredictedMove[] = [];
  public currentPosition: { x: number; y: number };
  public readonly driftEpsilon: number = 0.5;

  constructor(initialPosition: { x: number; y: number } = { x: 0, y: 0 }, driftEpsilon: number = 0.5) {
    this.currentPosition = { ...initialPosition };
    this.driftEpsilon = driftEpsilon;
  }

  /**
   * Registers a client-predicted local movement input
   */
  public addPredictedMove(targetX: number, targetY: number): PredictedMove {
    const move: PredictedMove = {
      seq: this.nextSeq++,
      startX: this.currentPosition.x,
      startY: this.currentPosition.y,
      targetX,
      targetY,
      timestamp: Date.now(),
    };

    this.pendingMoves.push(move);
    // Locally predict moving directly to target
    this.currentPosition = { x: targetX, y: targetY };
    return move;
  }

  /**
   * Reconciles authoritative server state against client prediction history
   */
  public reconcile(
    serverAckSeq: number,
    serverPosition: { x: number; y: number }
  ): { reconciled: boolean; correctedPosition: { x: number; y: number } } {
    // Discard moves processed by the server up to serverAckSeq
    this.pendingMoves = this.pendingMoves.filter((m) => m.seq > serverAckSeq);

    // Calculate drift between client current position and server truth + pending inputs
    let simulated = { ...serverPosition };
    for (const move of this.pendingMoves) {
      simulated.x = move.targetX;
      simulated.y = move.targetY;
    }

    const drift = Math.hypot(this.currentPosition.x - simulated.x, this.currentPosition.y - simulated.y);

    if (drift > this.driftEpsilon) {
      // Snap to replay position
      this.currentPosition = { ...simulated };
      return { reconciled: true, correctedPosition: { ...this.currentPosition } };
    }

    return { reconciled: false, correctedPosition: { ...this.currentPosition } };
  }

  public getPendingMoveCount(): number {
    return this.pendingMoves.length;
  }
}
