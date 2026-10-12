import { DyeService, DYE_PALETTES } from '../DyeService';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('Batch 32: Avatar Cosmetics Dye System & Palette Shader Validation', () => {
  describe('Color math and WebGL shader uniform validation', () => {
    it('validates 6-character hexadecimal color strings', () => {
      expect(DyeService.validateHexColor('#00F0FF')).toBe(true);
      expect(DyeService.validateHexColor('#ff007f')).toBe(true);
      expect(DyeService.validateHexColor('#123456')).toBe(true);

      expect(DyeService.validateHexColor('00F0FF')).toBe(false);
      expect(DyeService.validateHexColor('#FFF')).toBe(false);
      expect(DyeService.validateHexColor('#GGGGGG')).toBe(false);
      expect(DyeService.validateHexColor('')).toBe(false);
    });

    it('normalizes hex to 0..1 RGB shader vector and handles invalid hex correctly', () => {
      const white = DyeService.hexToRgbNormalized('#FFFFFF');
      expect(white).toEqual([1, 1, 1]);

      const black = DyeService.hexToRgbNormalized('#000000');
      expect(black).toEqual([0, 0, 0]);

      const pureRed = DyeService.hexToRgbNormalized('#FF0000');
      expect(pureRed).toEqual([1, 0, 0]);

      expect(() => DyeService.hexToRgbNormalized('bad-hex')).toThrow('Invalid hex color string');
    });

    it('computes palette shader uniforms and HSV properties for WebGL shading', () => {
      const uniforms = DyeService.computePaletteShaderUniforms('NEON_CYBERPUNK');
      expect(uniforms.u_primaryColor).toBeDefined();
      expect(uniforms.u_secondaryColor).toBeDefined();
      expect(uniforms.u_accentColor).toBeDefined();
      expect(uniforms.u_brightness).toBeGreaterThan(0);
      expect(uniforms.u_saturation).toBeGreaterThan(0);

      const palettes = DyeService.getAvailablePalettes();
      expect(palettes.length).toBeGreaterThanOrEqual(6);
      expect(palettes.some((p) => p.id === 'SOLAR_FLARE')).toBe(true);
    });
  });

  describe('Real database transactional dye application', () => {
    it('transactionally deducts coins, updates avatar colors, and records transaction logs', async () => {
      const user = await createTestUser({ havenCoins: 500 });

      // Ensure avatar exists
      await prisma.avatar.upsert({
        where: { userId: user.id },
        update: { topColor: '#000000', hairColor: '#333333' },
        create: { userId: user.id, topColor: '#000000', hairColor: '#333333' },
      });

      // 1. Apply Neon Cyberpunk primary dye to topColor
      const res1 = await DyeService.applyDye(user.id, 'topColor', '#00F0FF', 50);
      expect(res1.success).toBe(true);
      expect(res1.slot).toBe('topColor');
      expect(res1.color).toBe('#00F0FF');
      expect(res1.remainingCoins).toBe(450);

      // Verify DB update
      const dbAvatar1 = await prisma.avatar.findUnique({ where: { userId: user.id } });
      expect(dbAvatar1?.topColor).toBe('#00F0FF');

      // 2. Apply dye to hairColor
      const res2 = await DyeService.applyDye(user.id, 'hairColor', '#FF007F', 100);
      expect(res2.success).toBe(true);
      expect(res2.color).toBe('#FF007F');
      expect(res2.remainingCoins).toBe(350);

      const dbAvatar2 = await prisma.avatar.findUnique({ where: { userId: user.id } });
      expect(dbAvatar2?.hairColor).toBe('#FF007F');

      // Verify transaction logs
      const txLogs = await prisma.transactionLog.findMany({
        where: { senderId: user.id, type: 'DYE_PURCHASE' },
      });
      expect(txLogs.length).toBe(2);

      // 3. Error on invalid slot
      await expect(
        DyeService.applyDye(user.id, 'invalidSlot' as any, '#00F0FF', 50)
      ).rejects.toThrow('Invalid avatar dye slot');

      // 4. Error on insufficient coins
      await expect(
        DyeService.applyDye(user.id, 'bottomColor', '#B5EAD7', 10000)
      ).rejects.toThrow('Insufficient HavenCoins');

      // Cleanup
      await prisma.transactionLog.deleteMany({ where: { senderId: user.id } });
      await prisma.avatar.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });
});
