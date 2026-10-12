import { getIO } from '../sockets';
import { redisClient } from '../redis';
import { SOCKET_EVENTS } from '@havenworld/shared';

export type GlobalEventType =
  | 'METEOR_SHOWER'
  | 'DOUBLE_COINS'
  | 'FESTIVAL'
  | 'ANNOUNCEMENT'
  | 'AURORA_BOREALIS'
  | 'GOLDEN_HOUR'
  | 'STARLIGHT_CARNIVAL';

export interface GlobalWorldEvent {
  id: string;
  type: GlobalEventType;
  title: string;
  description: string;
  multiplier: number;
  startsAt: number;
  durationMinutes: number;
  isActive: boolean;
}

export interface ScheduledWorldEvent extends GlobalWorldEvent {
  scheduledStartAt: number;
  countdownSeconds: number;
  status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

export class GlobalEventService {
  private static activeEvent: GlobalWorldEvent | null = null;
  private static scheduledEvents = new Map<string, ScheduledWorldEvent>();

  /**
   * Triggers and synchronizes an immediate server-wide live event
   */
  static triggerGlobalEvent(
    type: GlobalEventType,
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

    // Persist in Redis with TTL matching duration (fire-and-forget)
    if (redisClient.isOpen) {
      redisClient
        .set('world:live_events:active', JSON.stringify(event), {
          EX: Math.max(60, durationMinutes * 60),
        })
        .catch(() => {});
    }

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

  /**
   * Schedules an upcoming live event with synchronized countdown timer
   */
  static async scheduleGlobalEvent(params: {
    type: GlobalEventType;
    title: string;
    description: string;
    startsInSeconds: number;
    durationMinutes?: number;
    multiplier?: number;
  }): Promise<ScheduledWorldEvent> {
    const {
      type,
      title,
      description,
      startsInSeconds,
      durationMinutes = 60,
      multiplier = 1.5,
    } = params;

    const scheduledStartAt = Date.now() + startsInSeconds * 1000;
    const eventId = `sched_evt_${Date.now()}_${type.toLowerCase()}`;

    const scheduledEvent: ScheduledWorldEvent = {
      id: eventId,
      type,
      title,
      description,
      multiplier,
      startsAt: scheduledStartAt,
      scheduledStartAt,
      durationMinutes,
      countdownSeconds: startsInSeconds,
      isActive: false,
      status: 'SCHEDULED',
    };

    this.scheduledEvents.set(eventId, scheduledEvent);

    if (redisClient.isOpen) {
      await redisClient.hSet(
        'world:live_events:scheduled',
        eventId,
        JSON.stringify(scheduledEvent)
      );
    }

    this.broadcastCountdownBanner(scheduledEvent);
    return scheduledEvent;
  }

  /**
   * Broadcasts a countdown banner toast to all connected clients
   */
  static broadcastCountdownBanner(event: ScheduledWorldEvent) {
    const secondsRemaining = this.calculateCountdownRemaining(event);
    const minutesRemaining = Math.ceil(secondsRemaining / 60);

    const io = getIO();
    if (io) {
      io.emit(SOCKET_EVENTS.SERVER_ALERT, {
        type: 'EVENT_COUNTDOWN',
        title: `Upcoming: ${event.title}`,
        message: `${event.description} Begins in ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'}!`,
        countdownSeconds: secondsRemaining,
        multiplier: event.multiplier,
      });
    }
  }

  /**
   * Calculates remaining countdown seconds until start
   */
  static calculateCountdownRemaining(event: ScheduledWorldEvent): number {
    const remainingMs = event.scheduledStartAt - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  /**
   * Retrieves active live event (checks expiration)
   */
  static getActiveEvent(): GlobalWorldEvent | null {
    if (!this.activeEvent) return null;
    const now = Date.now();
    if (now > this.activeEvent.startsAt + this.activeEvent.durationMinutes * 60_000) {
      this.activeEvent.isActive = false;
      this.activeEvent = null;
      return null;
    }
    return this.activeEvent;
  }

  /**
   * Retrieves list of upcoming scheduled events with current countdown seconds
   */
  static getUpcomingEvents(): ScheduledWorldEvent[] {
    const list: ScheduledWorldEvent[] = [];
    const now = Date.now();

    for (const [id, evt] of this.scheduledEvents.entries()) {
      if (evt.status !== 'SCHEDULED') continue;
      const remaining = Math.max(0, Math.ceil((evt.scheduledStartAt - now) / 1000));
      if (remaining <= 0) {
        evt.status = 'ACTIVE';
        evt.isActive = true;
        this.activeEvent = evt;
        this.scheduledEvents.delete(id);
      } else {
        evt.countdownSeconds = remaining;
        list.push(evt);
      }
    }

    return list.sort((a, b) => a.scheduledStartAt - b.scheduledStartAt);
  }

  /**
   * Cancels a scheduled event
   */
  static async cancelScheduledEvent(eventId: string): Promise<boolean> {
    const evt = this.scheduledEvents.get(eventId);
    if (!evt) return false;

    evt.status = 'CANCELLED';
    this.scheduledEvents.delete(eventId);

    if (redisClient.isOpen) {
      await redisClient.hDel('world:live_events:scheduled', eventId);
    }
    return true;
  }

  /**
   * Terminates currently active event
   */
  static async terminateActiveEvent(): Promise<void> {
    if (this.activeEvent) {
      this.activeEvent.isActive = false;
      this.activeEvent = null;
    }
    if (redisClient.isOpen) {
      await redisClient.del('world:live_events:active');
    }
  }

  static getCurrentCoinMultiplier(): number {
    const event = this.getActiveEvent();
    return event && event.isActive ? event.multiplier : 1.0;
  }
}
