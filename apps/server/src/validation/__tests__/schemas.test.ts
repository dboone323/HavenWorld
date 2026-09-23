import {
  CreateClubSchema,
  CreateGalleryPhotoSchema,
  hasNoMarkup,
} from '../schemas';

describe('XSS display-field validation (audit finding: stored XSS)', () => {
  describe('hasNoMarkup', () => {
    it('accepts plain and unicode text', () => {
      expect(hasNoMarkup('Haven Café Club 42!')).toBe(true);
      expect(hasNoMarkup('We love vibes :)')).toBe(true);
    });

    it('rejects angle brackets and control characters', () => {
      expect(hasNoMarkup('<img src=x onerror=alert(1)>')).toBe(false);
      expect(hasNoMarkup('a<b')).toBe(false);
      expect(hasNoMarkup('bad>name')).toBe(false);
      expect(hasNoMarkup('null\u0000byte')).toBe(false);
      expect(hasNoMarkup('bell\u0007')).toBe(false);
    });
  });

  describe('CreateClubSchema', () => {
    it('rejects markup in name, motto and tag', () => {
      expect(CreateClubSchema.safeParse({ name: '<svg onload=alert(1)>' }).success).toBe(false);
      expect(
        CreateClubSchema.safeParse({ name: 'Cool Club', motto: '<script>alert(1)</script>' })
          .success
      ).toBe(false);
      expect(
        CreateClubSchema.safeParse({ name: 'Cool Club', tag: '"><img src=1>' }).success
      ).toBe(false);
    });

    it('rejects "<3" in club name (display field — no markup at all)', () => {
      expect(CreateClubSchema.safeParse({ name: '<3 Lounge' }).success).toBe(false);
    });

    it('accepts normal clubs including unicode', () => {
      expect(CreateClubSchema.safeParse({ name: 'Café Club' }).success).toBe(true);
      expect(
        CreateClubSchema.safeParse({ name: 'Nice Club', motto: 'Good vibes only', tag: 'NICE' })
          .success
      ).toBe(true);
    });

    it('enforces original length limits (3-24 name, 80 motto, 5 tag)', () => {
      expect(CreateClubSchema.safeParse({ name: 'ab' }).success).toBe(false);
      expect(CreateClubSchema.safeParse({ name: 'x'.repeat(25) }).success).toBe(false);
      expect(
        CreateClubSchema.safeParse({ name: 'Valid Club', motto: 'x'.repeat(81) }).success
      ).toBe(false);
      expect(
        CreateClubSchema.safeParse({ name: 'Valid Club', tag: 'TOOLONG' }).success
      ).toBe(false);
    });
  });

  describe('CreateGalleryPhotoSchema', () => {
    it('rejects markup in caption and roomName', () => {
      expect(
        CreateGalleryPhotoSchema.safeParse({ imageUrl: 'data:x', caption: '<b>hi</b>' }).success
      ).toBe(false);
      expect(
        CreateGalleryPhotoSchema.safeParse({ imageUrl: 'data:x', roomName: '<iframe>' }).success
      ).toBe(false);
    });

    it('accepts a normal photo and defaults roomName', () => {
      const parsed = CreateGalleryPhotoSchema.safeParse({
        imageUrl: 'data:image/jpeg;base64,AAA',
        caption: 'Sunny loft',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.roomName).toBe('Haven Park');
    });
  });
});