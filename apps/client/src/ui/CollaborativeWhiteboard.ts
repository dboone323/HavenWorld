export interface WhiteboardStroke {
  id: string;
  authorId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  width: number;
}

export class CollaborativeWhiteboard {
  public strokes: WhiteboardStroke[] = [];
  public width: number;
  public height: number;

  constructor(width: number = 800, height: number = 600) {
    this.width = width;
    this.height = height;
  }

  /**
   * Adds a stroke segment drawn by a player
   */
  addStroke(stroke: Omit<WhiteboardStroke, 'id'>): WhiteboardStroke {
    const fullStroke: WhiteboardStroke = {
      ...stroke,
      id: `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    this.strokes.push(fullStroke);
    return fullStroke;
  }

  /**
   * Clears the whiteboard
   */
  clear(): void {
    this.strokes = [];
  }

  /**
   * Serializes current whiteboard canvas state
   */
  exportState(): WhiteboardStroke[] {
    return [...this.strokes];
  }

  /**
   * Loads synchronized strokes from server
   */
  loadState(strokes: WhiteboardStroke[]): void {
    this.strokes = [...strokes];
  }
}
