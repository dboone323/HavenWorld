import { getIO } from '../sockets';
import { prisma } from '../prisma';

export type TramState = 'BOARDING' | 'DEPARTING' | 'IN_TRANSIT' | 'ARRIVED';

export interface TransitStatus {
  tramId: string;
  state: TramState;
  currentStation: string;
  nextStation: string;
  passengers: string[]; // userIds
  timeToNextStateSeconds: number;
}

export interface TransitAnnouncement {
  message: string;
  state: TramState;
  station: string;
  nextStation: string;
  audioChime: string;
}

export interface StationScheduleEntry {
  station: string;
  routeIndex: number;
  isCurrent: boolean;
  isNext: boolean;
  estimatedArrivalSeconds: number;
}

export interface TransitTicket {
  ticketId: string;
  userId: string;
  purchasedAt: number;
  validUntil: number;
  used: boolean;
}

export class TransitService {
  public static readonly TRAM_STATIONS: readonly string[] = [
    'Plaza Central Station',
    'Sanctuary Isles',
    'Neon Promenade',
    'Lakeside Wharf',
  ];

  public static readonly TICKET_PRICE = 5; // havenCoins
  public static readonly TICKET_VALIDITY_MS = 24 * 60 * 60 * 1000; // 24 hours

  private static state: TramState = 'BOARDING';
  private static stationIndex: number = 0;
  private static passengers: Set<string> = new Set();
  private static userTickets = new Map<string, TransitTicket>();

  static get currentStation(): string {
    return this.TRAM_STATIONS[this.stationIndex];
  }

  static get nextStation(): string {
    const nextIdx = (this.stationIndex + 1) % this.TRAM_STATIONS.length;
    return this.TRAM_STATIONS[nextIdx];
  }

  /**
   * Returns schedule and ETA for all stations along the transit loop
   */
  static getStationSchedule(): StationScheduleEntry[] {
    const stateInterval = 30; // seconds per state
    return this.TRAM_STATIONS.map((station, idx) => {
      const isCurrent = idx === this.stationIndex;
      const isNext = idx === (this.stationIndex + 1) % this.TRAM_STATIONS.length;

      let hops = (idx - this.stationIndex + this.TRAM_STATIONS.length) % this.TRAM_STATIONS.length;
      if (hops === 0 && this.state !== 'BOARDING') {
        hops = this.TRAM_STATIONS.length;
      }
      const estimatedArrivalSeconds = hops * (stateInterval * 4);

      return {
        station,
        routeIndex: idx,
        isCurrent,
        isNext,
        estimatedArrivalSeconds,
      };
    });
  }

  /**
   * Generates atmospheric station and tram public announcement
   */
  static getAnnouncement(): TransitAnnouncement {
    switch (this.state) {
      case 'BOARDING':
        return {
          message: `Ding dong! Haven Tram 01 is now boarding at ${this.currentStation} for ${this.nextStation}. Please have your transit pass ready.`,
          state: this.state,
          station: this.currentStation,
          nextStation: this.nextStation,
          audioChime: 'chime_boarding',
        };
      case 'DEPARTING':
        return {
          message: `Doors closing. Haven Tram 01 departing ${this.currentStation} toward ${this.nextStation}. Stand clear of the doors.`,
          state: this.state,
          station: this.currentStation,
          nextStation: this.nextStation,
          audioChime: 'chime_departing',
        };
      case 'IN_TRANSIT':
        return {
          message: `Now in transit along the skyway toward ${this.nextStation}. Enjoy your ride.`,
          state: this.state,
          station: this.currentStation,
          nextStation: this.nextStation,
          audioChime: 'ambient_transit_hum',
        };
      case 'ARRIVED':
        return {
          message: `Ding dong! Now arriving at ${this.currentStation}. Please check your belongings and watch your step when disembarking.`,
          state: this.state,
          station: this.currentStation,
          nextStation: this.nextStation,
          audioChime: 'chime_arrival',
        };
    }
  }

  /**
   * Purchases a passenger transit ticket with havenCoins deduction
   */
  static async purchaseTicket(
    userId: string
  ): Promise<{ ticketId: string; validUntil: number; cost: number }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    if (user.havenCoins < this.TICKET_PRICE) {
      throw new Error(`Insufficient funds: ticket costs ${this.TICKET_PRICE} HavenCoins`);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { havenCoins: { decrement: this.TICKET_PRICE } },
    });

    const now = Date.now();
    const ticket: TransitTicket = {
      ticketId: `tkt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      userId,
      purchasedAt: now,
      validUntil: now + this.TICKET_VALIDITY_MS,
      used: false,
    };
    this.userTickets.set(userId, ticket);

    return {
      ticketId: ticket.ticketId,
      validUntil: ticket.validUntil,
      cost: this.TICKET_PRICE,
    };
  }

  /**
   * Checks if user has a valid active ticket
   */
  static hasValidTicket(userId: string): boolean {
    const ticket = this.userTickets.get(userId);
    if (!ticket) return false;
    return Date.now() <= ticket.validUntil;
  }

  /**
   * Boards a player onto the tram
   */
  static boardTram(
    userId: string,
    stationId?: string,
    options: { requireTicket?: boolean } = {}
  ): { success: boolean; passengerCount: number; station: string } {
    if (this.state !== 'BOARDING') {
      throw new Error('Tram is in transit. Boarding is closed.');
    }

    if (options.requireTicket && !this.hasValidTicket(userId)) {
      throw new Error('Valid transit ticket required to board.');
    }

    this.passengers.add(userId);
    return {
      success: true,
      passengerCount: this.passengers.size,
      station: this.currentStation,
    };
  }

  /**
   * Leaves the tram
   */
  static leaveTram(userId: string): { success: boolean; passengerCount: number } {
    this.passengers.delete(userId);
    return { success: true, passengerCount: this.passengers.size };
  }

  /**
   * Transitions the tram state along the scheduled circular route
   */
  static advanceState(): TransitStatus {
    switch (this.state) {
      case 'BOARDING':
        this.state = 'DEPARTING';
        break;
      case 'DEPARTING':
        this.state = 'IN_TRANSIT';
        break;
      case 'IN_TRANSIT':
        this.state = 'ARRIVED';
        this.stationIndex = (this.stationIndex + 1) % this.TRAM_STATIONS.length;
        break;
      case 'ARRIVED':
        this.state = 'BOARDING';
        break;
    }

    const status = this.getStatus();
    const announcement = this.getAnnouncement();

    const io = getIO();
    if (io) {
      io.emit('transit:state_update', status);
      io.emit('transit:announcement', announcement);
    }
    return status;
  }

  static getStatus(): TransitStatus {
    return {
      tramId: 'haven_tram_01',
      state: this.state,
      currentStation: this.currentStation,
      nextStation: this.nextStation,
      passengers: Array.from(this.passengers),
      timeToNextStateSeconds: 30,
    };
  }

  static resetForTesting(): void {
    this.state = 'BOARDING';
    this.passengers.clear();
    this.stationIndex = 0;
    this.userTickets.clear();
  }
}
