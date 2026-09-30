import { DraggablePanel } from './DraggablePanel';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';

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
  private static modalInstance: HTMLElement | null = null;
  private static sharedInstance: CollaborativeWhiteboard | null = null;

  public strokes: WhiteboardStroke[] = [];
  public width: number;
  public height: number;

  constructor(width: number = 800, height: number = 600) {
    this.width = width;
    this.height = height;
  }

  public static getInstance(): CollaborativeWhiteboard {
    if (!this.sharedInstance) {
      this.sharedInstance = new CollaborativeWhiteboard(640, 420);
    }
    return this.sharedInstance;
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

  /**
   * Opens the interactive Collaborative Whiteboard modal when a player clicks a TV/Whiteboard in the room
   */
  public static openModal(roomId: string): void {
    if (typeof document === 'undefined' || this.modalInstance) return;
    const wb = this.getInstance();

    const overlay = document.createElement('div');
    overlay.id = 'whiteboard-modal-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9800;
      font-family: Calibri, sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a1a2e;
      border: 2px solid #4ecdc4;
      border-radius: 14px;
      padding: 18px;
      color: #fff;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;color:#4ecdc4;font-size:1.15rem;">🎨 Loft Collaborative Whiteboard</h3>
        <button id="wb-close-btn" style="background:none;border:none;color:#aaa;font-size:1.3rem;cursor:pointer;">✕</button>
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <label style="font-size:0.85rem;">Color:</label>
        <input id="wb-color" type="color" value="#4ecdc4" style="cursor:pointer;border:none;background:none;width:32px;height:28px;" />
        <label style="font-size:0.85rem;">Size:</label>
        <input id="wb-size" type="range" min="2" max="14" value="4" style="width:90px;" />
        <button id="wb-clear-btn" style="margin-left:auto;background:#ef4444;color:#fff;border:none;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:0.85rem;font-weight:bold;">🗑️ Clear</button>
      </div>
      <canvas id="wb-canvas" width="${wb.width}" height="${wb.height}" style="background:#0f172a;border:1px solid #334155;border-radius:8px;cursor:crosshair;touch-action:none;"></canvas>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    DraggablePanel.makeDraggable(panel);
    this.modalInstance = overlay;

    const canvas = panel.querySelector('#wb-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    const colorInput = panel.querySelector('#wb-color') as HTMLInputElement;
    const sizeInput = panel.querySelector('#wb-size') as HTMLInputElement;

    const renderAll = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      for (const s of wb.strokes) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
        ctx.stroke();
      }
    };
    renderAll();

    let drawing = false;
    let lastX = 0;
    let lastY = 0;

    const getPos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.round(((e.clientX - r.left) / r.width) * canvas.width),
        y: Math.round(((e.clientY - r.top) / r.height) * canvas.height),
      };
    };

    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      const p = getPos(e);
      lastX = p.x;
      lastY = p.y;
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = getPos(e);
      const stroke = wb.addStroke({
        authorId: authService.user?.id || 'local',
        x0: lastX,
        y0: lastY,
        x1: p.x,
        y1: p.y,
        color: colorInput.value,
        width: parseInt(sizeInput.value, 10) || 4,
      });
      lastX = p.x;
      lastY = p.y;
      renderAll();
      socketService.emit('whiteboard:stroke' as any, { roomId, stroke });
    });

    const stopDraw = () => {
      drawing = false;
    };
    canvas.addEventListener('pointerup', stopDraw);
    canvas.addEventListener('pointerleave', stopDraw);

    panel.querySelector('#wb-clear-btn')?.addEventListener('click', () => {
      wb.clear();
      renderAll();
      socketService.emit('whiteboard:clear' as any, { roomId });
    });

    const unsubStroke = socketService.on<{ roomId: string; stroke: WhiteboardStroke }>(
      'whiteboard:stroke' as any,
      (data) => {
        if (data?.roomId === roomId && data.stroke) {
          wb.strokes.push(data.stroke);
          renderAll();
        }
      }
    );

    const unsubClear = socketService.on<{ roomId: string }>('whiteboard:clear' as any, (data) => {
      if (data?.roomId === roomId) {
        wb.clear();
        renderAll();
      }
    });

    const closeModal = () => {
      unsubStroke();
      unsubClear();
      overlay.remove();
      this.modalInstance = null;
    };

    panel.querySelector('#wb-close-btn')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }
}
