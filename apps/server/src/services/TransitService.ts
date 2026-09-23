import { getIO } from '../sockets';

export type TramState = 'BOARDING' | 'DEPARTING' | 'IN_TRANSIT' | 'ARRIVED';

export interface TransitStatus {
  tramId: string;
  state: TramState;
  currentStation: string;
  nextStation: string;
  passengers: string[]; // userIds
  timeToNextStateSeconds: number;
}

export class TransitService {
  private static state: TramState = 'BOARDING';
  private static currentStation: string = 'Plaza Central Station';
  private static nextStation: string = 'Sanctuary Isles';
  private static passengers: Set<string> = new Set();
  private static cycleStartTime: number = Date.now();

  /**
   * Boards a player onto the tram
   */
  static boardTram(userId: string, stationId: string): { success: boolean; passengerCount: number } {
    if (this.state !== 'BOARDING') {
      throw new Error('Tram is in transit. Boarding is closed.');
    }
    this.passengers.add(userId);
    return { success: true, passengerCount: this.passengers.size };
  }

  /**
   * Leaves the tram
   */
  static leaveTram(userId: string): { success: boolean; passengerCount: number } {
    this.passengers.delete(userId);
    return { success: true, passengerCount: this.passengers.size };
  }

  /**
   * Transitions the tram state along the scheduled route
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
        const temp = this.currentStation;
        this.currentStation = this.nextStation;
        this.nextStation = temp;
        break;
      case 'ARRIVED':
        this.state = 'BOARDING';
        break;
    }

    this.cycleStartTime = Date.now();

    const status = this.getStatus();
    const io = getIO();
    if (io) {
      io.emit('transit:state_update', status);
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
    this.currentStation = 'Plaza Central Station';
    this.nextStation = 'Sanctuary Isles';
  }
}
