import {
  AdoptPetSchema,
  NamePetSchema,
  GuestbookSignSchema,
  ChatSchema,
} from '../socketSchemas';

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('socket schema XSS guards (audit finding: stored XSS)', () => {
  it('rejects markup in pet names (adopt + rename)', () => {
    expect(
      AdoptPetSchema.safeParse({ petType: 'CAT', name: '<img src=x onerror=alert(1)>' }).success
    ).toBe(false);
    expect(NamePetSchema.safeParse({ petId: VALID_UUID, name: '<b>Luna</b>' }).success).toBe(false);
  });

  it('still accepts normal pet names (trim preserved)', () => {
    const parsed = AdoptPetSchema.safeParse({ petType: 'DOG', name: '  Luna  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe('Luna');
  });

  it('keeps free-text chat and guestbook able to hold "<3" (output-escaped instead)', () => {
    const chat = ChatSchema.safeParse({ content: 'I <3 this place', roomId: 'room-park' });
    expect(chat.success).toBe(true);

    const guestbook = GuestbookSignSchema.safeParse({
      roomId: 'loft-1',
      message: '<3 your loft! <3 <3',
    });
    expect(guestbook.success).toBe(true);
  });
});