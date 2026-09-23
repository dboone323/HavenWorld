import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { GuestbookPanel } from '../GuestbookPanel';

type Handler = (data: unknown) => void;

const { handlers, emitSpy, unsubSpy } = vi.hoisted(() => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const emitSpy = vi.fn();
  const unsubSpy = vi.fn();
  return { handlers, emitSpy, unsubSpy };
});

vi.mock('../../services/socket', () => ({
  socketService: {
    emit: emitSpy,
    on: (event: string, cb: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(cb);
      return () => {
        unsubSpy(event);
        handlers.get(event)?.delete(cb);
      };
    },
  },
}));

function fire(event: string, data: unknown): void {
  for (const cb of [...(handlers.get(event) ?? [])]) cb(data);
}

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

describe('GuestbookPanel', () => {
  beforeEach(() => {
    handlers.clear();
    emitSpy.mockClear();
    unsubSpy.mockClear();
  });

  afterEach(() => {
    GuestbookPanel.dismiss();
    document.getElementById('guestbook-panel-overlay')?.remove();
    handlers.clear();
    emitSpy.mockClear();
    unsubSpy.mockClear();
  });

  it('opens a single overlay and requests the first page over the socket', () => {
    GuestbookPanel.show('room-1');

    expect(document.querySelectorAll('#guestbook-panel-overlay')).toHaveLength(1);
    expect(emitSpy).toHaveBeenCalledWith(SOCKET_EVENTS.GET_GUESTBOOK, {
      roomId: 'room-1',
      page: 1,
    });

    // Re-opening for another room must not stack overlays
    GuestbookPanel.show('room-2');
    expect(document.querySelectorAll('#guestbook-panel-overlay')).toHaveLength(1);
    expect(emitSpy).toHaveBeenLastCalledWith(SOCKET_EVENTS.GET_GUESTBOOK, {
      roomId: 'room-2',
      page: 1,
    });
  });

  it('renders entries with escaped markup (stored-XSS regression)', () => {
    GuestbookPanel.show('room-1');
    fire(SOCKET_EVENTS.GUESTBOOK_PAGE, {
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
    // DOM-level: no live nodes from the payload
    expect(overlay.querySelector('script')).toBeNull();
    expect(overlay.querySelector('img')).toBeNull();
    // Serialized: payload appears only in escaped form
    expect(overlay.innerHTML).not.toContain('<img src=x');
    expect(overlay.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(overlay.innerHTML).toContain('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
    // Non-hex avatar value never reaches the inline style
    expect(overlay.innerHTML).not.toContain('javascript:');
    // Pagination state rendered
    expect(document.getElementById('guestbook-page-label')?.textContent).toBe('Page 1 / 3');
  });

  it('shows an empty state when there are no entries', () => {
    GuestbookPanel.show('room-1');
    fire(SOCKET_EVENTS.GUESTBOOK_PAGE, {
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
    expect(emitSpy).toHaveBeenCalledWith(SOCKET_EVENTS.SIGN_GUESTBOOK, {
      roomId: 'room-1',
      message: 'Hello there!',
    });
    expect(input.value).toBe('');

    // Blank message is a no-op
    emitSpy.mockClear();
    input.value = '   ';
    signBtn.click();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('refreshes the page when GUESTBOOK_SIGNED arrives for this room only', () => {
    GuestbookPanel.show('room-1');
    emitSpy.mockClear();

    fire(SOCKET_EVENTS.GUESTBOOK_SIGNED, { entry: entry() });
    expect(emitSpy).toHaveBeenCalledWith(SOCKET_EVENTS.GET_GUESTBOOK, {
      roomId: 'room-1',
      page: 1,
    });

    emitSpy.mockClear();
    fire(SOCKET_EVENTS.GUESTBOOK_SIGNED, { entry: entry({ roomId: 'other-room' }) });
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('offers owner-only delete buttons that emit DELETE_GUESTBOOK_ENTRY', () => {
    GuestbookPanel.show('room-1', { canDelete: true });
    fire(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [entry()],
      page: 1,
      totalPages: 1,
      totalEntries: 1,
    });

    const overlay = document.getElementById('guestbook-panel-overlay')!;
    const del = overlay.querySelector('.guestbook-delete') as HTMLButtonElement;
    expect(del).not.toBeNull();

    emitSpy.mockClear();
    del.click();
    expect(emitSpy).toHaveBeenCalledWith(SOCKET_EVENTS.DELETE_GUESTBOOK_ENTRY, {
      entryId: 'entry-1',
    });
    expect(emitSpy).toHaveBeenCalledWith(SOCKET_EVENTS.GET_GUESTBOOK, {
      roomId: 'room-1',
      page: 1,
    });
  });

  it('hides delete buttons for non-owners', () => {
    GuestbookPanel.show('room-1');
    fire(SOCKET_EVENTS.GUESTBOOK_PAGE, {
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

    fire(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [entry()],
      page: 1,
      totalPages: 3,
      totalEntries: 25,
    });
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    emitSpy.mockClear();
    next.click();
    expect(emitSpy).toHaveBeenCalledWith(SOCKET_EVENTS.GET_GUESTBOOK, {
      roomId: 'room-1',
      page: 2,
    });

    fire(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [entry()],
      page: 3,
      totalPages: 3,
      totalEntries: 25,
    });
    expect(next.disabled).toBe(true);
  });

  it('unsubscribes socket listeners and removes the overlay on dismiss', () => {
    GuestbookPanel.show('room-1');
    expect(unsubSpy).not.toHaveBeenCalled();

    GuestbookPanel.dismiss();
    expect(unsubSpy).toHaveBeenCalledTimes(2);
    expect(document.getElementById('guestbook-panel-overlay')).toBeNull();

    // Late events after dismiss must not resurrect the panel
    const calls = emitSpy.mock.calls.length;
    fire(SOCKET_EVENTS.GUESTBOOK_PAGE, {
      entries: [entry()],
      page: 1,
      totalPages: 1,
      totalEntries: 1,
    });
    expect(emitSpy.mock.calls.length).toBe(calls);
    expect(document.getElementById('guestbook-panel-overlay')).toBeNull();
  });
});
