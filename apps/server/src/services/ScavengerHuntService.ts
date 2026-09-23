import { prisma } from '../prisma';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export interface ScavengerTicket {
  id: string;
  roomId: string;
  x: number;
  y: number;
  rewardCoins: number;
  claimedBy: string | null;
  claimedAt: Date | null;
  createdAt: Date;
}

export class ScavengerHuntService {
  private static tickets = new Map<string, ScavengerTicket>();

  /**
   * Spawns a Golden Ticket collectible at a coordinate in a public room
   */
  static spawnTicket(roomId: string, x: number, y: number, rewardCoins: number = 100): ScavengerTicket {
    const id = `ticket_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const ticket: ScavengerTicket = {
      id,
      roomId,
      x,
      y,
      rewardCoins,
      claimedBy: null,
      claimedAt: null,
      createdAt: new Date(),
    };

    this.tickets.set(id, ticket);

    const io = getIO();
    if (io) {
      io.to(`room:${roomId}`).emit('scavenger:spawned', {
        id,
        x,
        y,
        rewardCoins,
      });
    }

    return ticket;
  }

  /**
   * Returns all uncollected tickets in a room
   */
  static getActiveTickets(roomId: string): ScavengerTicket[] {
    return Array.from(this.tickets.values()).filter(
      (t) => t.roomId === roomId && t.claimedBy === null
    );
  }

  /**
   * Claims a hidden ticket by proximity
   */
  static async claimTicket(ticketId: string, userId: string, playerX: number, playerY: number) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) throw new Error('Scavenger ticket not found');
    if (ticket.claimedBy) throw new Error('Ticket has already been claimed');

    // Proximity check (within 2 tiles)
    const dist = Math.hypot(playerX - ticket.x, playerY - ticket.y);
    if (dist > 2.5) {
      throw new Error('Too far away from ticket to collect');
    }

    ticket.claimedBy = userId;
    ticket.claimedAt = new Date();

    // Award reward coins in database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { havenCoins: { increment: ticket.rewardCoins } },
      select: { id: true, username: true, havenCoins: true },
    });

    const io = getIO();
    if (io) {
      io.to(`room:${ticket.roomId}`).emit('scavenger:claimed', {
        ticketId,
        winnerId: userId,
        winnerName: updatedUser.username,
        rewardCoins: ticket.rewardCoins,
      });
    }

    return {
      ticketId,
      rewardCoins: ticket.rewardCoins,
      userNewBalance: updatedUser.havenCoins,
    };
  }
}
