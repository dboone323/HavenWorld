import { RoomManager } from '../RoomManager';
import { defaultTestAvatar } from '../../../__tests__/helpers/factories';
import type { PlayerState } from '@havenworld/shared';

describe('Batch 39: Room Capacity Soft-Caps, Shard Spillover & Queue Redirection', () => {
  let rm: RoomManager;

  beforeEach(() => {
    rm = new RoomManager();
  });

  const createPlayer = (id: string, username: string): PlayerState => ({
    id,
    username,
    x: 100,
    y: 100,
    z: 0,
    rotY: 0,
    direction: 'down',
    isMoving: false,
    avatar: defaultTestAvatar,
  });

  it('manages custom capacity limits, softCap spillover to shards, and VIP priority bypass', () => {
    const baseRoom = 'room-park';
    rm.setRoomCapacityLimits(baseRoom, { softCap: 2, hardCap: 3 });

    // 1. Join 2 players into base room
    rm.joinRoom(baseRoom, 's_1', createPlayer('u_1', 'Player 1'));
    rm.joinRoom(baseRoom, 's_2', createPlayer('u_2', 'Player 2'));
    expect(rm.getOccupantCount(baseRoom)).toBe(2);

    // 2. Normal 3rd player resolves target instance -> softCap reached, spills over to shard #2
    const normalSpill = rm.resolveTargetRoomInstance(baseRoom, 'u_3', false, 3);
    expect(normalSpill.canEnter).toBe(true);
    expect(normalSpill.targetRoomId).toBe('room-park#2');
    expect(normalSpill.shardIndex).toBe(2);

    // 3. VIP player arrives -> bypasses softCap up to hardCap, allowed into base room
    const vipEntry = rm.resolveTargetRoomInstance(baseRoom, 'u_vip', true, 3);
    expect(vipEntry.canEnter).toBe(true);
    expect(vipEntry.targetRoomId).toBe('room-park');
    expect(vipEntry.shardIndex).toBe(1);

    // VIP joins base room -> base room now at hardCap (3)
    rm.joinRoom(baseRoom, 's_vip', createPlayer('u_vip', 'VIP User'));
    expect(rm.getOccupantCount(baseRoom)).toBe(3);

    // 4. Another VIP arrives -> base room is at hardCap, so VIP goes to shard #2
    const vipShard2 = rm.resolveTargetRoomInstance(baseRoom, 'u_vip2', true, 3);
    expect(vipShard2.canEnter).toBe(true);
    expect(vipShard2.targetRoomId).toBe('room-park#2');
  });

  it('redirects to waiting queue when all shards are full, and admits queued players on departures', () => {
    const baseRoom = 'room-clubhouse';
    rm.setRoomCapacityLimits(baseRoom, { softCap: 1, hardCap: 1 });

    // Fill shard 1 (maxShards = 2)
    rm.joinRoom(baseRoom, 's_1', createPlayer('u_1', 'Occupant 1'));

    // Fill shard 2
    rm.joinRoom(`${baseRoom}#2`, 's_2', createPlayer('u_2', 'Occupant 2'));

    // 1. Next player tries to enter -> all 2 shards full -> queued
    const queueEntry = rm.resolveTargetRoomInstance(baseRoom, 'u_waiting_1', false, 2);
    expect(queueEntry.canEnter).toBe(false);
    expect(queueEntry.queuePosition).toBe(1);

    // 2. Second waiting player
    const queueEntry2 = rm.resolveTargetRoomInstance(baseRoom, 'u_waiting_2', false, 2);
    expect(queueEntry2.canEnter).toBe(false);
    expect(queueEntry2.queuePosition).toBe(2);

    // Check queue positions
    expect(rm.getQueuePosition(baseRoom, 'u_waiting_1')).toBe(1);
    expect(rm.getQueuePosition(baseRoom, 'u_waiting_2')).toBe(2);

    // Inspect shards
    const shards = rm.listRoomShards(baseRoom, 2);
    expect(shards.length).toBe(2);
    expect(shards[0].isFull).toBe(true);
    expect(shards[1].isFull).toBe(true);

    // 3. Occupant leaves base room -> next queued player is granted admission
    rm.leaveRoom('s_1');

    // Queued player 1 now resolves target and can enter!
    const admittedEntry = rm.resolveTargetRoomInstance(baseRoom, 'u_waiting_1', false, 2);
    expect(admittedEntry.canEnter).toBe(true);
    expect(admittedEntry.targetRoomId).toBe(baseRoom);

    // Dequeue player 2
    expect(rm.dequeueWaitingPlayer(baseRoom, 'u_waiting_2')).toBe(true);
    expect(rm.getQueuePosition(baseRoom, 'u_waiting_2')).toBeNull();
  });
});
