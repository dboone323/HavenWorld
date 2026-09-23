export interface RadarBlip {
  id: string;
  type: 'local_player' | 'other_player' | 'resource_node' | 'portal';
  x: number; // 0 to 1 normalized radar coordinate
  y: number; // 0 to 1 normalized radar coordinate
  color: string;
}

export class MinimapRadar {
  public roomWidth: number;
  public roomHeight: number;
  public radarSize: number;

  constructor(roomWidth: number = 20, roomHeight: number = 20, radarSize: number = 140) {
    this.roomWidth = Math.max(1, roomWidth);
    this.roomHeight = Math.max(1, roomHeight);
    this.radarSize = radarSize;
  }

  /**
   * Projects a room isometric/grid coordinate into normalized 2D radar space [0..1, 0..1]
   */
  projectToRadar(roomX: number, roomY: number): { x: number; y: number } {
    const clampedX = Math.max(0, Math.min(this.roomWidth, roomX));
    const clampedY = Math.max(0, Math.min(this.roomHeight, roomY));

    return {
      x: clampedX / this.roomWidth,
      y: clampedY / this.roomHeight,
    };
  }

  /**
   * Converts normalized coordinates to pixel offsets on the radar element
   */
  getPixelPosition(normX: number, normY: number): { px: number; py: number } {
    return {
      px: Math.round(normX * this.radarSize),
      py: Math.round(normY * this.radarSize),
    };
  }

  createBlip(
    id: string,
    type: RadarBlip['type'],
    roomX: number,
    roomY: number
  ): RadarBlip {
    const norm = this.projectToRadar(roomX, roomY);
    let color = '#ffffff';

    switch (type) {
      case 'local_player':
        color = '#10b981'; // bright green
        break;
      case 'other_player':
        color = '#38bdf8'; // light blue
        break;
      case 'resource_node':
        color = '#fbbf24'; // amber
        break;
      case 'portal':
        color = '#c084fc'; // purple
        break;
    }

    return {
      id,
      type,
      x: norm.x,
      y: norm.y,
      color,
    };
  }
}
