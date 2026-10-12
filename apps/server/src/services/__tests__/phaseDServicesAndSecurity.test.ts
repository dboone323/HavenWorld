import { ScavengerHuntService } from '../ScavengerHuntService';
import { SeasonalThemeService } from '../SeasonalThemeService';
import { TransitService } from '../TransitService';
import { verifyStartupSecurityAssertions } from '../../middleware/security';
import { generateAccessToken, verifyAccessToken } from '../../auth/tokens';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('Phase D: Security Hardening & Service Wiring Validations', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    TransitService.resetForTesting();
  });

  describe('JWT_ACCESS_SECRET || JWT_SECRET Precedence Alignment', () => {
    it('prioritizes JWT_ACCESS_SECRET over JWT_SECRET in verifyStartupSecurityAssertions', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pw@127.0.0.1:5432/havenworld';
      process.env.REDIS_URL = 'redis://localhost:6379/0';
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
      process.env.JWT_SECRET = 'short';

      expect(() => verifyStartupSecurityAssertions()).not.toThrow();

      process.env.JWT_ACCESS_SECRET = 'short';
      process.env.JWT_SECRET = 'a'.repeat(64);
      expect(() => verifyStartupSecurityAssertions()).toThrow(/64 hex/);
    });

    it('signs and verifies access tokens consistently', () => {
      const token = generateAccessToken('user-phase-d', 'PhaseDUser', 'PLAYER');
      const verified = verifyAccessToken(token);
      expect(verified.userId).toBe('user-phase-d');
      expect(verified.username).toBe('PhaseDUser');
      expect(verified.role).toBe('PLAYER');
    });
  });

  describe('ScavengerHuntService', () => {
    it('spawns tickets and filters active targets optionally by roomId', () => {
      const t1 = ScavengerHuntService.spawnTicket('room-park', 4, 5, 100);
      const t2 = ScavengerHuntService.spawnTicket('room-beach', -2, 3, 150);

      const parkTargets = ScavengerHuntService.getActiveTickets('room-park');
      expect(parkTargets.some((t) => t.id === t1.id)).toBe(true);
      expect(parkTargets.some((t) => t.id === t2.id)).toBe(false);

      const allTargets = ScavengerHuntService.getActiveTickets();
      expect(allTargets.some((t) => t.id === t1.id)).toBe(true);
      expect(allTargets.some((t) => t.id === t2.id)).toBe(true);
    });
  });

  describe('SeasonalThemeService', () => {
    it('returns deterministic seasonal overlay config for all 4 seasons', () => {
      expect(SeasonalThemeService.getSeasonalConfig(new Date('2026-04-10T00:00:00Z')).season).toBe('SPRING');
      expect(SeasonalThemeService.getSeasonalConfig(new Date('2026-07-10T00:00:00Z')).season).toBe('SUMMER');
      expect(SeasonalThemeService.getSeasonalConfig(new Date('2026-10-01T00:00:00Z')).season).toBe('AUTUMN');
      expect(SeasonalThemeService.getSeasonalConfig(new Date('2026-12-20T00:00:00Z')).season).toBe('WINTER');
    });
  });

  describe('TransitService', () => {
    it('manages boarding, departure lockouts, and disembarking', () => {
      const status0 = TransitService.getStatus();
      expect(status0.state).toBe('BOARDING');

      const res = TransitService.boardTram('rider-1', 'Plaza Central Station');
      expect(res.success).toBe(true);
      expect(res.passengerCount).toBe(1);

      TransitService.advanceState(); // -> DEPARTING
      expect(() => TransitService.boardTram('rider-2', 'Plaza Central Station')).toThrow(/closed/i);

      const leaveRes = TransitService.leaveTram('rider-1');
      expect(leaveRes.success).toBe(true);
      expect(leaveRes.passengerCount).toBe(0);
    });

    it('provides dynamic multi-station schedules and atmospheric announcements across route transitions', () => {
      const schedule = TransitService.getStationSchedule();
      expect(schedule.length).toBe(4);
      expect(schedule[0].station).toBe('Plaza Central Station');
      expect(schedule[0].isCurrent).toBe(true);
      expect(schedule[1].station).toBe('Sanctuary Isles');
      expect(schedule[1].isNext).toBe(true);

      // Check announcements across states
      const boardingAnnouncement = TransitService.getAnnouncement();
      expect(boardingAnnouncement.audioChime).toBe('chime_boarding');
      expect(boardingAnnouncement.message).toContain('Plaza Central Station');

      TransitService.advanceState(); // -> DEPARTING
      const departingAnnouncement = TransitService.getAnnouncement();
      expect(departingAnnouncement.audioChime).toBe('chime_departing');

      TransitService.advanceState(); // -> IN_TRANSIT
      const inTransitAnnouncement = TransitService.getAnnouncement();
      expect(inTransitAnnouncement.audioChime).toBe('ambient_transit_hum');

      TransitService.advanceState(); // -> ARRIVED (advances station to Sanctuary Isles)
      const arrivedAnnouncement = TransitService.getAnnouncement();
      expect(arrivedAnnouncement.audioChime).toBe('chime_arrival');
      expect(arrivedAnnouncement.station).toBe('Sanctuary Isles');
      expect(TransitService.currentStation).toBe('Sanctuary Isles');
    });

    it('purchases transit tickets and enforces ticketing requirements on boarding', async () => {
      const rider = await createTestUser({ havenCoins: 50 });

      // Cannot board with ticket requirement when no ticket purchased
      expect(() =>
        TransitService.boardTram(rider.id, 'Plaza Central Station', { requireTicket: true })
      ).toThrow(/ticket required/i);

      // Purchase valid ticket
      const ticketRes = await TransitService.purchaseTicket(rider.id);
      expect(ticketRes.cost).toBe(TransitService.TICKET_PRICE);
      expect(TransitService.hasValidTicket(rider.id)).toBe(true);

      // Coin balance deducted in real DB
      const updatedRider = await prisma.user.findUniqueOrThrow({ where: { id: rider.id } });
      expect(updatedRider.havenCoins).toBe(50 - TransitService.TICKET_PRICE);

      // Boarding succeeds with valid ticket
      const boardRes = TransitService.boardTram(rider.id, 'Plaza Central Station', {
        requireTicket: true,
      });
      expect(boardRes.success).toBe(true);
      expect(boardRes.passengerCount).toBe(1);
    });
  });
});
