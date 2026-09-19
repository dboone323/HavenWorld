import { RoomManager } from '../RoomManager';
import { defaultTestAvatar } from '../../../__tests__/helpers/factories';
import type { PlayerState, ChatMessage } from '@havenworld/shared';

describe('RoomManager', () => {
  let rm: RoomManager;

  beforeEach(() => {
    rm = new RoomManager();
  });

  it('should add user to room on join and track room state', () => {
    const player: PlayerState = {
      id: 'user_1',
      username: 'Alice',
      x: 100,
      y: 150,
      z: 0,
      rotY: 0,
      direction: 'down',
      isMoving: false,
      avatar: defaultTestAvatar,
    };

    rm.joinRoom('town_square', 'socket_1', player);
    const roomState = rm.getRoomState('town_square');

    expect(roomState).toBeDefined();
    expect(roomState?.players.has('socket_1')).toBe(true);
    expect(rm.getOccupantCount('town_square')).toBe(1);
    expect(rm.getPlayerRoom('socket_1')).toBe('town_square');
    expect(rm.getUserId('socket_1')).toBe('user_1');
  });

  it('should remove user from room when they leave', () => {
    const player1: PlayerState = { id: 'user_1', username: 'Alice', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar };
    const player2: PlayerState = { id: 'user_2', username: 'Bob', x: 10, y: 10, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar };

    rm.joinRoom('town_square', 'socket_1', player1);
    rm.joinRoom('town_square', 'socket_2', player2);

    expect(rm.getOccupantCount('town_square')).toBe(2);

    const left = rm.leaveRoom('socket_1');
    expect(left).toEqual({ roomId: 'town_square', playerId: 'user_1' });
    expect(rm.getOccupantCount('town_square')).toBe(1);
    expect(rm.getRoomState('town_square')?.players.has('socket_1')).toBe(false);
  });

  it('should update player position and direction on movePlayer', () => {
    const player: PlayerState = { id: 'user_1', username: 'Alice', x: 100, y: 150, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar };
    rm.joinRoom('town_square', 'socket_1', player);

    rm.movePlayer('socket_1', 110, 160, 'right', true, 5, 1.57);

    const updated = rm.getPlayer('user_1');
    expect(updated).toBeDefined();
    expect(updated?.x).toBe(110);
    expect(updated?.y).toBe(160);
    expect(updated?.z).toBe(5);
    expect(updated?.rotY).toBe(1.57);
    expect(updated?.direction).toBe('right');
    expect(updated?.isMoving).toBe(true);
  });

  it('should clean up empty non-park rooms from memory when last user leaves', () => {
    const player: PlayerState = { id: 'user_1', username: 'Solo', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar };
    rm.joinRoom('loft_user_1', 'socket_1', player);

    expect(rm.getRoomState('loft_user_1')).toBeDefined();

    rm.leaveRoom('socket_1');
    expect(rm.getRoomState('loft_user_1')).toBeUndefined();
  });

  it('should keep public community room (room-park) in memory even when empty', () => {
    const player: PlayerState = { id: 'user_1', username: 'Visitor', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar };
    rm.joinRoom('room-park', 'socket_1', player);

    rm.leaveRoom('socket_1');
    expect(rm.getRoomState('room-park')).toBeDefined();
    expect(rm.getOccupantCount('room-park')).toBe(0);
  });

  it('should maintain a 50-message ring buffer for room chat history', () => {
    for (let i = 1; i <= 60; i++) {
      const msg: ChatMessage = {
        id: `msg_${i}`,
        playerId: 'u1',
        username: 'Alice',
        content: `Message ${i}`,
        timestamp: Date.now(),
      };
      rm.addChatMessage('town_square', msg);
    }

    const state = rm.getRoomState('town_square');
    expect(state?.chatHistory.length).toBe(50);
    expect(state?.chatHistory[0].content).toBe('Message 11');
    expect(state?.chatHistory[49].content).toBe('Message 60');
  });

  it('should store and filter room furniture states', () => {
    rm.addFurniture('town_square', {
      id: 'f_1',
      itemId: 'chair',
      x: 1,
      y: 0,
      z: 2,
      rotation: 0,
      ownerId: 'u1',
    });
    rm.addFurniture('town_square', {
      id: 'f_2',
      itemId: 'table',
      x: 3,
      y: 0,
      z: 4,
      rotation: 90,
      ownerId: 'u1',
    });

    let state = rm.getRoomState('town_square');
    expect(state?.furniture.length).toBe(2);

    rm.removeFurniture('town_square', 'f_1');
    state = rm.getRoomState('town_square');
    expect(state?.furniture.length).toBe(1);
    expect(state?.furniture[0].id).toBe('f_2');
  });

  it('should locate player across rooms using getPlayer', () => {
    const player: PlayerState = { id: 'target_user_id', username: 'Charlie', x: 50, y: 60, z: 0, rotY: 0, direction: 'up', isMoving: false, avatar: defaultTestAvatar };
    rm.joinRoom('cozy_cafe', 'sock_charlie', player);

    const found = rm.getPlayer('target_user_id');
    expect(found).toBeDefined();
    expect(found?.username).toBe('Charlie');
    expect(found?.roomId).toBe('cozy_cafe');

    const notFound = rm.getPlayer('non_existent_id');
    expect(notFound).toBeUndefined();
  });
});
