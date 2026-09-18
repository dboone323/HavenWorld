/**
 * HavenWorld — Player-to-Player Direct Trading System.
 * Handles trade session lifecycle, anti-scam offer locking, and atomic exchange.
 */

export interface TradeOffer {
  coins: number;
  items: string[];
  locked: boolean;
  confirmed: boolean;
}

export interface TradeSession {
  id: string;
  player1Id: string;
  player2Id: string;
  player1Offer: TradeOffer;
  player2Offer: TradeOffer;
  status: 'pending' | 'active' | 'completed' | 'canceled';
  createdAt: number;
}

export class TradeManager {
  private sessions: Map<string, TradeSession> = new Map();
  private playerToSession: Map<string, string> = new Map();

  createSession(p1Id: string, p2Id: string): TradeSession {
    // If either player is already trading, clear prior session
    this.cancelPlayerTrade(p1Id);
    this.cancelPlayerTrade(p2Id);

    const id = 'tr_' + Math.random().toString(36).substring(2, 10);
    const session: TradeSession = {
      id,
      player1Id: p1Id,
      player2Id: p2Id,
      player1Offer: { coins: 0, items: [], locked: false, confirmed: false },
      player2Offer: { coins: 0, items: [], locked: false, confirmed: false },
      status: 'pending',
      createdAt: Date.now()
    };

    this.sessions.set(id, session);
    this.playerToSession.set(p1Id, id);
    this.playerToSession.set(p2Id, id);
    return session;
  }

  getSession(id: string): TradeSession | undefined {
    return this.sessions.get(id);
  }

  getSessionForPlayer(playerId: string): TradeSession | undefined {
    const id = this.playerToSession.get(playerId);
    return id ? this.sessions.get(id) : undefined;
  }

  acceptRequest(id: string, acceptingPlayerId: string): TradeSession | null {
    const s = this.sessions.get(id);
    if (!s || s.status !== 'pending' || s.player2Id !== acceptingPlayerId) return null;
    s.status = 'active';
    return s;
  }

  updateOffer(id: string, playerId: string, coins: number, items: string[]): TradeSession | null {
    const s = this.sessions.get(id);
    if (!s || s.status !== 'active') return null;

    const offer = playerId === s.player1Id ? s.player1Offer : playerId === s.player2Id ? s.player2Offer : null;
    if (!offer) return null;

    offer.coins = Math.max(0, Math.floor(coins || 0));
    offer.items = Array.isArray(items) ? [...items] : [];

    // Anti-scam protection: any change unlocks and unconfirms BOTH sides
    s.player1Offer.locked = false;
    s.player1Offer.confirmed = false;
    s.player2Offer.locked = false;
    s.player2Offer.confirmed = false;

    return s;
  }

  lockOffer(id: string, playerId: string, locked: boolean): TradeSession | null {
    const s = this.sessions.get(id);
    if (!s || s.status !== 'active') return null;

    const offer = playerId === s.player1Id ? s.player1Offer : playerId === s.player2Id ? s.player2Offer : null;
    if (!offer) return null;

    offer.locked = locked;
    if (!locked) {
      s.player1Offer.confirmed = false;
      s.player2Offer.confirmed = false;
    }
    return s;
  }

  confirmTrade(id: string, playerId: string): { session: TradeSession | null; ready: boolean } {
    const s = this.sessions.get(id);
    if (!s || s.status !== 'active') return { session: null, ready: false };

    // Both parties must have locked offers before confirmation is accepted
    if (!s.player1Offer.locked || !s.player2Offer.locked) {
      return { session: s, ready: false };
    }

    if (playerId === s.player1Id) {
      s.player1Offer.confirmed = true;
    } else if (playerId === s.player2Id) {
      s.player2Offer.confirmed = true;
    } else {
      return { session: null, ready: false };
    }

    const ready = s.player1Offer.confirmed && s.player2Offer.confirmed;
    if (ready) {
      s.status = 'completed';
      this.playerToSession.delete(s.player1Id);
      this.playerToSession.delete(s.player2Id);
    }

    return { session: s, ready };
  }

  cancelTrade(id: string): TradeSession | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    s.status = 'canceled';
    this.playerToSession.delete(s.player1Id);
    this.playerToSession.delete(s.player2Id);
    this.sessions.delete(id);
    return s;
  }

  cancelPlayerTrade(playerId: string): TradeSession | null {
    const id = this.playerToSession.get(playerId);
    return id ? this.cancelTrade(id) : null;
  }
}
