export interface ConnectFourMatch {
  id: string;
  cabinetId: string;
  player1Id: string;
  player2Id: string;
  currentTurn: string; // userId
  board: number[][]; // 6 rows x 7 cols (0 = empty, 1 = p1, 2 = p2)
  status: 'IN_PROGRESS' | 'FINISHED';
  winnerId: string | null; // null if in progress or draw
  isDraw: boolean;
  createdAt: number;
}

export class ArcadeService {
  private static matches = new Map<string, ConnectFourMatch>();

  /**
   * Initializes a new Connect-4 match between two adjacent players at a cabinet
   */
  static startMatch(player1Id: string, player2Id: string, cabinetId: string): ConnectFourMatch {
    if (player1Id === player2Id) {
      throw new Error('Cannot start an arcade match against yourself');
    }

    const matchId = `c4_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    // 6 rows x 7 columns empty grid
    const board: number[][] = Array.from({ length: 6 }, () => Array(7).fill(0));

    const match: ConnectFourMatch = {
      id: matchId,
      cabinetId,
      player1Id,
      player2Id,
      currentTurn: player1Id,
      board,
      status: 'IN_PROGRESS',
      winnerId: null,
      isDraw: false,
      createdAt: Date.now(),
    };

    this.matches.set(matchId, match);
    return match;
  }

  static getMatch(matchId: string): ConnectFourMatch | null {
    return this.matches.get(matchId) || null;
  }

  /**
   * Drops a disc into the chosen column (0 to 6)
   */
  static makeMove(matchId: string, playerId: string, col: number): ConnectFourMatch {
    const match = this.matches.get(matchId);
    if (!match) throw new Error('Arcade match not found');
    if (match.status === 'FINISHED') throw new Error('Match has already finished');
    if (match.currentTurn !== playerId) throw new Error('Not your turn');
    if (col < 0 || col > 6 || !Number.isInteger(col)) throw new Error('Invalid column index (0-6)');

    const disc = playerId === match.player1Id ? 1 : 2;

    // Find the lowest unoccupied row in this column
    let targetRow = -1;
    for (let r = 5; r >= 0; r--) {
      if (match.board[r][col] === 0) {
        targetRow = r;
        break;
      }
    }

    if (targetRow === -1) {
      throw new Error('Column is already full');
    }

    match.board[targetRow][col] = disc;

    // Check for win condition (4 in a line)
    if (this.checkWin(match.board, targetRow, col, disc)) {
      match.status = 'FINISHED';
      match.winnerId = playerId;
      return match;
    }

    // Check for draw (all columns full)
    const isFull = match.board[0].every((cell) => cell !== 0);
    if (isFull) {
      match.status = 'FINISHED';
      match.isDraw = true;
      return match;
    }

    // Alternate turn
    match.currentTurn = playerId === match.player1Id ? match.player2Id : match.player1Id;
    return match;
  }

  /**
   * Checks if placing a piece at (row, col) creates 4 in a row in any direction
   */
  private static checkWin(board: number[][], row: number, col: number, disc: number): boolean {
    const directions = [
      [0, 1],  // Horizontal
      [1, 0],  // Vertical
      [1, 1],  // Diagonal \
      [1, -1], // Diagonal /
    ];

    for (const [dr, dc] of directions) {
      let count = 1;

      // Count positive direction
      for (let step = 1; step <= 3; step++) {
        const r = row + dr * step;
        const c = col + dc * step;
        if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === disc) {
          count++;
        } else {
          break;
        }
      }

      // Count negative direction
      for (let step = 1; step <= 3; step++) {
        const r = row - dr * step;
        const c = col - dc * step;
        if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === disc) {
          count++;
        } else {
          break;
        }
      }

      if (count >= 4) return true;
    }

    return false;
  }
}
