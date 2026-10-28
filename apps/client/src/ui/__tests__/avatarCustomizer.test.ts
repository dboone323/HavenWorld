import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AvatarCustomizer } from '../AvatarCustomizer';
import { authService } from '../../services/auth';

describe('AvatarCustomizer Lifecycle & Cleanup', () => {
  let customizer: AvatarCustomizer;

  beforeEach(() => {
    document.body.innerHTML = '';
    (authService as unknown as { _user: unknown })._user = {
      id: 'test-user-customizer',
      username: 'Styler',
      avatar: {
        gender: 'female',
        skinTone: '#F5CBA7',
        outfitBody: 'pink-llama-sweater',
        outfitLegs: 'denim-jeans',
        eyes: 'basic-blue-eyes',
        hairStyle: 'wavy-hair',
      },
    };
    customizer = new AvatarCustomizer();
  });

  afterEach(() => {
    customizer?.dispose();
    document.body.innerHTML = '';
  });

  it('renders modal overlay into document body on open()', () => {
    customizer.open();

    const overlay = document.getElementById('avatar-customizer');
    expect(overlay).not.toBeNull();
    expect(document.body.contains(overlay)).toBe(true);

    expect(overlay?.textContent).toContain('Wardrobe & Style');
    expect(overlay?.textContent).toContain('Avatar Preview');
  });

  it('cleanly unmounts modal overlay, clears preview layers, and detaches on dispose()', () => {
    customizer.open();
    expect(document.getElementById('avatar-customizer')).not.toBeNull();

    // Call dispose()
    customizer.dispose();

    // Verify DOM element removed
    expect(document.getElementById('avatar-customizer')).toBeNull();

    // Verify internal references cleared
    const internal = customizer as unknown as {
      overlay: HTMLElement | null;
      previewLayers: Record<string, HTMLElement>;
    };
    expect(internal.overlay).toBeNull();
    expect(Object.keys(internal.previewLayers).length).toBe(0);
  });

  it('is idempotent when calling dispose() repeatedly or before open()', () => {
    // Calling dispose() on unmounted customizer
    expect(() => customizer.dispose()).not.toThrow();

    customizer.open();
    expect(document.getElementById('avatar-customizer')).not.toBeNull();

    // First dispose
    customizer.dispose();
    expect(document.getElementById('avatar-customizer')).toBeNull();

    // Second dispose
    expect(() => customizer.dispose()).not.toThrow();
    expect(document.getElementById('avatar-customizer')).toBeNull();
  });
});
