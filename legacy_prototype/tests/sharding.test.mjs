import test from 'node:test';
import assert from 'node:assert/strict';
import { ShardManager, getBaseRoomId, getShardIndex } from '../src/server/sharding.ts';
import { MessageBroker } from '../src/server/broker.ts';
import { RoomManager, createDefaultRooms } from '../src/server/rooms.ts';

test('getBaseRoomId and getShardIndex extract shard components accurately', () => {
  assert.equal(getBaseRoomId('plaza'), 'plaza');
  assert.equal(getBaseRoomId('plaza_#2'), 'plaza');
  assert.equal(getBaseRoomId('plaza_#15'), 'plaza');
  assert.equal(getBaseRoomId('cafe_#3'), 'cafe');

  assert.equal(getShardIndex('plaza'), 1);
  assert.equal(getShardIndex('plaza_#2'), 2);
  assert.equal(getShardIndex('plaza_#10'), 10);
});

test('ShardManager dynamically creates mirrored shards when capacity is exceeded', () => {
  const rooms = new RoomManager(createDefaultRooms());
  const manager = new ShardManager(3); // Cap at 3 for deterministic test

  // Shard 1: initially has 0 players, routes to base 'plaza'
  assert.equal(manager.resolveShard('plaza', rooms), 'plaza');

  // Fill shard 1 with 3 players
  const plaza = rooms.get('plaza');
  assert.ok(plaza);
  plaza.players.set('p1', { id: 'p1' });
  plaza.players.set('p2', { id: 'p2' });
  plaza.players.set('p3', { id: 'p3' });

  // 4th player should trigger shard #2
  const shard2Id = manager.resolveShard('plaza', rooms);
  assert.equal(shard2Id, 'plaza_#2');
  const shard2 = rooms.get('plaza_#2');
  assert.ok(shard2, 'mirrored shard #2 was created in RoomManager');
  assert.equal(shard2.isPublic, true);
  assert.equal(shard2.furniture.length, plaza.furniture.length, 'cloned starter furniture');

  // Fill shard #2 with 3 players
  shard2.players.set('p4', { id: 'p4' });
  shard2.players.set('p5', { id: 'p5' });
  shard2.players.set('p6', { id: 'p6' });

  // 7th player routes to shard #3
  const shard3Id = manager.resolveShard('plaza', rooms);
  assert.equal(shard3Id, 'plaza_#3');
  assert.ok(rooms.get('plaza_#3'));
});

test('ShardManager prunes empty mirrored shards but never the root room', () => {
  const rooms = new RoomManager(createDefaultRooms());
  const manager = new ShardManager(2);

  const shard2Id = manager.resolveShard('plaza', rooms, 0); // Force shard creation
  assert.equal(shard2Id, 'plaza_#2');
  assert.ok(rooms.has('plaza_#2'));

  // Pruning with 0 players in plaza_#2 should remove it
  const pruned = manager.pruneEmptyShards(rooms);
  assert.deepEqual(pruned, ['plaza_#2']);
  assert.equal(rooms.has('plaza_#2'), false);
  assert.equal(rooms.has('plaza'), true, 'root room plaza must never be pruned');
});

test('MessageBroker routes cross-shard messages via event subscriptions', () => {
  const broker = new MessageBroker('test-node');
  const received = [];

  const unsubscribe = broker.subscribe('usr_recipient_123', (msg) => {
    received.push(msg);
  });

  broker.publish({
    type: 'WHISPER',
    fromId: 'usr_sender_456',
    fromName: 'Alice',
    toId: 'usr_recipient_123',
    payload: { text: 'Hello from Shard #2!' },
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].fromName, 'Alice');
  assert.equal(received[0].payload.text, 'Hello from Shard #2!');
  assert.ok(received[0].id.startsWith('msg_'));

  // Unsubscribe stops future messages
  unsubscribe();
  broker.publish({
    type: 'WHISPER',
    fromId: 'usr_sender_456',
    fromName: 'Alice',
    toId: 'usr_recipient_123',
    payload: { text: 'Second message' },
  });
  assert.equal(received.length, 1, 'no further messages after unsubscribe');
});
