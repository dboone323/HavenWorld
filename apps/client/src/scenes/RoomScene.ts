import Phaser from 'phaser';
// @ts-ignore — easystarjs has no types package
import EasyStar from 'easystarjs';
import type { PlayerState, ChatMessage } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/events';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';
import { Avatar } from '../entities/Avatar';

const TILE_SIZE   = 32;
const MOVE_SPEED  = 120; // px/s

interface RoomSceneData {
  roomId: string;
  mapKey:  string;
}

/**
 * RoomScene — primary game world scene.
 *
 * Features:
 * - Tiled tilemap loading (4 layers: Ground, Walls, Objects, Overlay)
 * - Collision on Walls layer
 * - EasyStar.js A* click-to-move pathfinding
 * - Camera follow + tilemap-bounds clamping
 * - Real-time multiplayer sync via socketService
 * - Depth-sorting avatars by Y position each frame
 */
export class RoomScene extends Phaser.Scene {
  private roomId!:   string;
  private mapKey!:   string;
  private map!:      Phaser.Tilemaps.Tilemap;
  private wallsLayer!: Phaser.Tilemaps.TilemapLayer;

  private localAvatar!:  Avatar;
  private avatars:       Map<string, Avatar> = new Map();

  private easystar!: EasyStar;
  private targetPath: { x: number; y: number }[] = [];
  private pathStepIndex = 0;

  // Unsub functions for socket listeners
  private unsubs: Array<() => void> = [];

  constructor() {
    super({ key: 'RoomScene' });
  }

  init(data: RoomSceneData): void {
    this.roomId = data.roomId;
    this.mapKey  = data.mapKey;
  }

  create(): void {
    // ── Tilemap ────────────────────────────────────────────────────────────
    this.map = this.make.tilemap({ key: this.mapKey });

    const tilesetKey = this.mapKey === 'lobby' || this.mapKey === 'cafe'
      ? 'tileset-indoor'
      : 'tileset-outdoor';

    const tileset = this.map.addTilesetImage('tileset', tilesetKey)!;

    this.map.createLayer('Ground',  tileset, 0, 0);
    this.wallsLayer = this.map.createLayer('Walls',   tileset, 0, 0)!;
    this.map.createLayer('Objects', tileset, 0, 0);
    this.map.createLayer('Overlay', tileset, 0, 0);

    this.wallsLayer.setCollisionByExclusion([-1]);

    // ── Camera ─────────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);

    // ── EasyStar pathfinding ────────────────────────────────────────────────
    this.easystar = new EasyStar.js();
    const grid = this.buildWalkGrid();
    this.easystar.setGrid(grid);
    this.easystar.setAcceptableTiles([0]);
    this.easystar.enableDiagonals();
    this.easystar.disableCornerCutting();

    // ── Socket: join room ──────────────────────────────────────────────────
    const sock = socketService.connect();

    // ── Local player avatar ────────────────────────────────────────────────
    const spawnX = this.map.widthInPixels  / 2;
    const spawnY = this.map.heightInPixels / 2;
    const user   = authService.user!;

    this.localAvatar = new Avatar(this, spawnX, spawnY, user.username, user.avatar);
    this.add.existing(this.localAvatar);
    this.cameras.main.startFollow(this.localAvatar, true, 0.1, 0.1);

    // ── Pointer click-to-move ──────────────────────────────────────────────
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.rightButtonDown()) return;
      const wx = ptr.worldX;
      const wy = ptr.worldY;
      const fromTX = Math.floor(this.localAvatar.x / TILE_SIZE);
      const fromTY = Math.floor(this.localAvatar.y / TILE_SIZE);
      const toTX   = Math.floor(wx / TILE_SIZE);
      const toTY   = Math.floor(wy / TILE_SIZE);

      this.easystar.findPath(fromTX, fromTY, toTX, toTY, (path) => {
        if (path && path.length > 1) {
          this.targetPath     = path.slice(1).map(p => ({
            x: p.x * TILE_SIZE + TILE_SIZE / 2,
            y: p.y * TILE_SIZE + TILE_SIZE / 2,
          }));
          this.pathStepIndex = 0;
        }
      });
      this.easystar.calculate();
    });

    // ── Socket listeners ────────────────────────────────────────────────────
    this.unsubs.push(
      socketService.on<{ players: PlayerState[]; furniture: unknown[] }>(
        SOCKET_EVENTS.ROOM_STATE,
        ({ players }) => this.syncRoomState(players),
      ),
      socketService.on<PlayerState>(
        SOCKET_EVENTS.ROOM_PLAYER_JOINED,
        (p) => this.addRemotePlayer(p),
      ),
      socketService.on<{ id: string }>(
        SOCKET_EVENTS.ROOM_PLAYER_LEFT,
        ({ id }) => this.removeRemotePlayer(id),
      ),
      socketService.on<PlayerState>(
        SOCKET_EVENTS.PLAYER_POSITION,
        (p) => this.updateRemotePlayer(p),
      ),
      socketService.on<ChatMessage>(
        SOCKET_EVENTS.CHAT_MESSAGE,
        (msg) => this.handleChat(msg),
      ),
      socketService.on<PlayerState>(
        SOCKET_EVENTS.AVATAR_CHANGED,
        (p) => this.avatars.get(p.id)?.updateAvatar(p.avatar),
      ),
    );

    // Tell the server we've joined
    sock.emit(SOCKET_EVENTS.AUTH_JOIN, {
      token:  authService.token,
      roomId: this.roomId,
    });
  }

  update(_time: number, delta: number): void {
    this.easystar.calculate();

    if (this.targetPath.length > 0) {
      const step = this.targetPath[this.pathStepIndex];
      const dx = step.x - this.localAvatar.x;
      const dy = step.y - this.localAvatar.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const speed = MOVE_SPEED * (delta / 1000);

      if (dist <= speed) {
        this.localAvatar.setPosition(step.x, step.y);
        this.pathStepIndex++;
        if (this.pathStepIndex >= this.targetPath.length) {
          this.targetPath = [];
          this.localAvatar.stopWalk();
          this.emitPosition();
        }
      } else {
        const nx = dx / dist;
        const ny = dy / dist;
        this.localAvatar.x += nx * speed;
        this.localAvatar.y += ny * speed;

        const dir = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down' : 'up');
        this.localAvatar.playWalk(dir);
      }
    }

    // Depth-sort all avatars by Y
    this.localAvatar.setDepthByY();
    for (const av of this.avatars.values()) av.setDepthByY();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private syncRoomState(players: PlayerState[]): void {
    const userId = authService.user?.id;
    for (const p of players) {
      if (p.id === userId) continue;
      if (!this.avatars.has(p.id)) this.addRemotePlayer(p);
      else this.updateRemotePlayer(p);
    }
  }

  private addRemotePlayer(p: PlayerState): void {
    if (this.avatars.has(p.id)) return;
    const av = new Avatar(this, p.x, p.y, p.username, p.avatar);
    this.add.existing(av);
    this.avatars.set(p.id, av);
    if (p.isMoving) av.playWalk(p.direction);
  }

  private updateRemotePlayer(p: PlayerState): void {
    const av = this.avatars.get(p.id);
    if (!av) { this.addRemotePlayer(p); return; }
    av.setPosition(p.x, p.y);
    if (p.isMoving) av.playWalk(p.direction);
    else            av.stopWalk(p.direction);
  }

  private removeRemotePlayer(id: string): void {
    const av = this.avatars.get(id);
    if (av) { av.destroy(); this.avatars.delete(id); }
  }

  private handleChat(msg: ChatMessage): void {
    this.avatars.get(msg.playerId)?.showSpeechBubble(msg.text);
    // UIScene picks up the same CHAT_MESSAGE event for the chat log
  }

  private emitPosition(): void {
    socketService.emit(SOCKET_EVENTS.PLAYER_MOVE, {
      x:         this.localAvatar.x,
      y:         this.localAvatar.y,
      direction: this.localAvatar.direction,
      isMoving:  false,
      roomId:    this.roomId,
    });
  }

  private buildWalkGrid(): number[][] {
    const rows = this.map.height;
    const cols = this.map.width;
    const grid: number[][] = [];

    for (let row = 0; row < rows; row++) {
      const rowArr: number[] = [];
      for (let col = 0; col < cols; col++) {
        const tile = this.wallsLayer.getTileAt(col, row);
        rowArr.push(tile && tile.index !== -1 ? 1 : 0);
      }
      grid.push(rowArr);
    }
    return grid;
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  override shutdown(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    for (const av of this.avatars.values()) av.destroy();
    this.avatars.clear();
    this.input.off('pointerdown');
  }
}
