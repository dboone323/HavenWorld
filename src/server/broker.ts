/**
 * HavenWorld — Inter-Shard & Cross-Server Message Broker.
 * Facilitates private messages, trade invites, and friend notifications
 * across distinct room shards or server processes.
 *
 * NOTE: Node 22 strip-only TS mode — plain class fields only.
 */
import { EventEmitter } from 'node:events';
import type { Player } from './rooms.ts';

export interface BrokerMessage {
  id: string;
  type: 'WHISPER' | 'FRIEND_REQUEST' | 'FRIEND_UPDATE' | 'SYSTEM_ALERT';
  fromId: string;
  fromName: string;
  toId: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export type MessageHandler = (msg: BrokerMessage) => void;

export class MessageBroker {
  emitter: EventEmitter;
  nodeId: string;

  constructor(nodeId: string = 'node_default') {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.nodeId = nodeId;
  }

  /**
   * Subscribe to messages targeted at a specific player ID or room shard.
   */
  subscribe(targetId: string, handler: MessageHandler): () => void {
    const eventName = `target:${targetId}`;
    this.emitter.on(eventName, handler);
    return () => {
      this.emitter.off(eventName, handler);
    };
  }

  /**
   * Publish a message to a recipient regardless of their shard or room.
   */
  publish(msg: Omit<BrokerMessage, 'id' | 'timestamp'>): BrokerMessage {
    const fullMsg: BrokerMessage = {
      ...msg,
      id: `msg_${Math.random().toString(36).substring(2, 11)}`,
      timestamp: Date.now(),
    };
    this.emitter.emit(`target:${msg.toId}`, fullMsg);
    this.emitter.emit('broadcast:all', fullMsg);
    return fullMsg;
  }

  /**
   * Helper to route a private whisper to a target player.
   */
  routeWhisper(
    from: Player,
    toPlayerId: string,
    text: string,
    globalPlayers?: Map<string, Player>
  ): boolean {
    const target = globalPlayers?.get(toPlayerId);
    if (!target) return false;

    this.publish({
      type: 'WHISPER',
      fromId: from.id,
      fromName: from.name,
      toId: toPlayerId,
      payload: { text, sender: from.name, senderId: from.id },
    });
    return true;
  }
}

export default { MessageBroker };
