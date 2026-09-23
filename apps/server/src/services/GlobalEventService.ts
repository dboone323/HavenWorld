import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export interface GlobalWorldEvent {
  id: string;
  type: 'METEOR_SHOWER' | 'DOUBLE_COINS' | 'FESTIVAL' | 'ANNOUNCEMENT';
  title: string;
  description: string;
  multiplier: number;
  startsAt: number;
  durationMinutes: number;
  isActive: boolean;
}

export class GlobalEventService {
  private static activeEvent: GlobalWorldEvent | null = null;

  /**
   * Triggers and synchronizes a server-wide live event
   */
  static triggerGlobalEvent(
    type: 'METEOR_SHOWER' | 'DOUBLE_COINS' | 'FESTIVAL' | 'ANNOUNCEMENT',
    title: string,
    description: string,
    durationMinutes: number = 60,
    multiplier: number = 1.0
  ): GlobalWorldEvent {
    const event: GlobalWorldEvent = {
      id: `evt_${Date.now()}_${type.toLowerCase()}`,
      type,
      title,
      description,
      multiplier,
      startsAt: Date.now(),
      durationMinutes,
      isActive: true,
    };

    this.activeEvent = event;

    const io = getIO();
    if (io) {
      io.emit(SOCKET_EVENTS.SERVER_ALERT, {
        type: 'WORLD_EVENT',
        title,
        message: description,
        multiplier,
        expiresInSeconds: durationMinutes * 60,
      });
    }

    return event;
  }

  static getActiveEvent(): GlobalWorldEvent | null {
    if (!this.activeEvent) return null;
    const now = Date.now();
    if (now > this.activeEvent.startsAt + this.activeEvent.durationMinutes * 60_000) {
      this.activeEvent.isActive = false;
      return null;
    }
    return this.activeEvent;
  }

  static getCurrentCoinMultiplier(): number {
    const event = this.getActiveEvent();
    return event && event.isActive ? event.multiplier : 1.0;
  }
}
