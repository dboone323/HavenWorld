import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlayersListModal, RoomOccupant } from '../PlayersListModal';

describe('PlayersListModal (Real Functional UI Validation)', () => {
  beforeEach(() => {
    PlayersListModal.dismiss();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    PlayersListModal.dismiss();
    document.body.innerHTML = '';
  });

  it('renders room occupants with self badge and actions for other players', () => {
    const occupants: RoomOccupant[] = [
      { id: 'user-self', username: 'Daniel', isSelf: true, position: { x: 0, y: 0, z: 0 } },
      { id: 'user-remote', username: 'Alex', isSelf: false, position: { x: 2, y: 0, z: 2 } },
    ];

    PlayersListModal.show(occupants);

    const overlay = document.getElementById('players-list-overlay');
    expect(overlay).not.toBeNull();

    const title = overlay?.querySelector('h3');
    expect(title?.textContent).toBe('Room Occupants (2)');

    // Verify self row
    const selfNameEl = overlay?.textContent;
    expect(selfNameEl).toContain('Daniel');
    expect(selfNameEl).toContain('(You)');

    // Verify remote player row
    expect(selfNameEl).toContain('Alex');

    // Remote player should have Follow, Trade, and Visit buttons
    const followButtons = overlay?.querySelectorAll('button');
    const buttonTexts = Array.from(followButtons || []).map((b) => b.textContent);
    expect(buttonTexts).toContain('Follow');
    expect(buttonTexts).toContain('Trade');
    expect(buttonTexts).toContain('Visit');
  });

  it('calls onFollow callback with the target user ID when Follow button is clicked', () => {
    let followedUserId: string | null = null;
    const occupants: RoomOccupant[] = [
      { id: 'user-self', username: 'Daniel', isSelf: true },
      { id: 'user-target', username: 'Sarah', isSelf: false },
    ];

    PlayersListModal.show(occupants, (targetId) => {
      followedUserId = targetId;
    });

    const overlay = document.getElementById('players-list-overlay');
    const buttons = Array.from(overlay?.querySelectorAll('button') || []);
    const followBtn = buttons.find((b) => b.textContent === 'Follow');
    expect(followBtn).toBeDefined();

    followBtn?.click();

    expect(followedUserId).toBe('user-target');
    // Modal should dismiss after follow
    expect(document.getElementById('players-list-overlay')).toBeNull();
  });

  it('dismisses cleanly when close button is clicked', () => {
    const occupants: RoomOccupant[] = [
      { id: 'user-self', username: 'Daniel', isSelf: true },
    ];

    PlayersListModal.show(occupants);
    expect(document.getElementById('players-list-overlay')).not.toBeNull();

    const closeBtn = document.getElementById('btn-close-players-list');
    expect(closeBtn).not.toBeNull();
    closeBtn?.click();

    expect(document.getElementById('players-list-overlay')).toBeNull();
  });
});
