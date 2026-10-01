import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SOCKET_EVENTS } from '@havenworld/shared';
import type { SocketEventType } from '@havenworld/shared';
import { GuestbookPanel } from '../GuestbookPanel';
import { socketService } from '../../services/socket';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    roomId: 'room-1',
    authorId: 'u2',
    authorName: 'Skye',
    authorAvatar: '#4ecdc4',
    message: 'Lovely loft!',
    createdAt: '2026-09-23T12:00:00.000Z',
    ...overrides,
  };
}

describe('GuestbookPanel (Real Functional Validation)', () => {
  let emitted: Array<{ event: SocketEventType; payload: unknown }> = [];
  let unsubCount = 0;
  let offEmit: (() => void) | null = null;
  let offUnsub: (() => void) | null = null;

  beforeEach(() => {
    socketService.disconnect();
    emitted = [];
    unsubCount = 0;
    offEmit = socketService.onEmit((event, args) => {
      emitted.push({ event, payload: args[0] });
    });
    offUnsub = socketService.onUnsubscribe(() => {
      unsubCount += 1;
    });
  });

  afterEach(() => {
    GuestbookPanel.dismiss();
    document.getElementById('guestbook-panel-overlay')?.remove();
    offEmit?.();
    offUnsub?.();
    offEmit = null;
    offUnsub = null;
  });

  it('opens a single overlay and requests the first page over the socket', () => {
    GuestbookPanel.show('room-1');

    expect(document.querySelectorAll('#guestbook-panel-overlay')).toHaveLength(1);
    expect(emitted).toContainEqual({
      event: SOCKET_EVENTS.GET_GUESTBOOK,
      payload: { roomId: 'room-1', page: 1 },
    });

    // Re-opening for another room must not stack overlays
    GuestbookPanel.show('room-2');
    expect(document.querySelectorAll('#guestbook-panel-overlay')).toHaveLength(1);
    expect(emitted[emitted.length - 1]).toEqual({
      event: SOCKET_EVENTS.GET_GUESTBOOK,
      payload: { roomId: 'room-2', page: 1 },
    });
  });

  it('renders entries with escaped markup (stored-XSS regression)', () => {
    GuestbookPanel.show('room-1');
    socketService.dispatchIncoming(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [
        entry({
          authorName: '<img src=x onerror=alert(1)>',
          authorAvatar: 'javascript:alert(1)',
          message: '<script>alert(document.cookie)</script>',
        }),
      ],
      page: 1,
      totalPages: 3,
      totalEntries: 25,
    });

    const overlay = document.getElementById('guestbook-panel-overlay')!;
    expect(overlay.querySelector('script')).toBeNull();
    expect(overlay.querySelector('img')).toBeNull();
    expect(overlay.innerHTML).not.toContain('<img src=x');
    expect(overlay.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(overlay.innerHTML).toContain('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
    expect(overlay.innerHTML).not.toContain('javascript:');
    expect(document.getElementById('guestbook-page-label')?.textContent).toBe('Page 1 / 3');
  });

  it('shows an empty state when there are no entries', () => {
    GuestbookPanel.show('room-1');
    socketService.dispatchIncoming(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [],
      page: 1,
      totalPages: 1,
      totalEntries: 0,
    });

    const overlay = document.getElementById('guestbook-panel-overlay')!;
    expect(overlay.textContent).toContain('No entries yet');
    expect(document.getElementById('guestbook-page-label')?.textContent).toBe('Page 1 / 1');
  });

  it('signs the book with a trimmed message and clears the input', () => {
    GuestbookPanel.show('room-1');
    const input = document.getElementById('guestbook-input') as HTMLTextAreaElement;
    const signBtn = document.getElementById('guestbook-sign') as HTMLButtonElement;

    input.value = '   Hello there!   ';
    signBtn.click();
    expect(emitted).toContainEqual({
      event: SOCKET_EVENTS.SIGN_GUESTBOOK,
      payload: { roomId: 'room-1', message: 'Hello there!' },
    });
    expect(input.value).toBe('');

    // Blank message is a no-op
    emitted = [];
    input.value = '   ';
    signBtn.click();
    expect(emitted).toHaveLength(0);
  });

  it('refreshes the page when GUESTBOOK_SIGNED arrives for this room only', () => {
    GuestbookPanel.show('room-1');
    emitted = [];

    socketService.dispatchIncoming(SOCKET_EVENTS.GUESTBOOK_SIGNED, { entry: entry() });
    expect(emitted).toContainEqual({
      event: SOCKET_EVENTS.GET_GUESTBOOK,
      payload: { roomId: 'room-1', page: 1 },
    });

    emitted = [];
    socketService.dispatchIncoming(SOCKET_EVENTS.GUESTBOOK_SIGNED, {
      entry: entry({ roomId: 'other-room' }),
    });
    expect(emitted).toHaveLength(0);
  });

  it('offers owner-only delete buttons that emit DELETE_GUESTBOOK_ENTRY', () => {
    GuestbookPanel.show('room-1', { canDelete: true });
    socketService.dispatchIncoming(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [entry()],
      page: 1,
      totalPages: 1,
      totalEntries: 1,
    });

    const overlay = document.getElementById('guestbook-panel-overlay')!;
    const del = overlay.querySelector('.guestbook-delete') as HTMLButtonElement;
    expect(del).not.toBeNull();

    emitted = [];
    del.click();
    expect(emitted).toContainEqual({
      event: SOCKET_EVENTS.DELETE_GUESTBOOK_ENTRY,
      payload: { entryId: 'entry-1' },
    });
    expect(emitted).toContainEqual({
      event: SOCKET_EVENTS.GET_GUESTBOOK,
      payload: { roomId: 'room-1', page: 1 },
    });
  });

  it('hides delete buttons for non-owners', () => {
    GuestbookPanel.show('room-1');
    socketService.dispatchIncoming(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [entry()],
      page: 1,
      totalPages: 1,
      totalEntries: 1,
    });

    const overlay = document.getElementById('guestbook-panel-overlay')!;
    expect(overlay.querySelector('.guestbook-delete')).toBeNull();
  });

  it('paginates with clamped prev/next controls', () => {
    GuestbookPanel.show('room-1');
    const prev = document.getElementById('guestbook-prev') as HTMLButtonElement;
    const next = document.getElementById('guestbook-next') as HTMLButtonElement;

    socketService.dispatchIncoming(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [entry()],
      page: 1,
      totalPages: 3,
      totalEntries: 25,
    });
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    emitted = [];
    next.click();
    expect(emitted).toContainEqual({
      event: SOCKET_EVENTS.GET_GUESTBOOK,
      payload: { roomId: 'room-1', page: 2 },
    });

    socketService.dispatchIncoming(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [entry()],
      page: 3,
      totalPages: 3,
      totalEntries: 25,
    });
    expect(next.disabled).toBe(true);
  });

  it('unsubscribes socket listeners and removes the overlay on dismiss', () => {
    GuestbookPanel.show('room-1');
    expect(unsubCount).toBe(0);

    GuestbookPanel.dismiss();
    expect(unsubCount).toBe(2);
    expect(document.getElementById('guestbook-panel-overlay')).toBeNull();

    // Late events after dismiss must not resurrect the panel
    emitted = [];
    socketService.dispatchIncoming(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [entry()],
      page: 1,
      totalPages: 1,
      totalEntries: 1,
    });
    expect(emitted).toHaveLength(0);
    expect(document.getElementById('guestbook-panel-overlay')).toBeNull();
  });
});
