import { DraggablePanel } from './DraggablePanel';

export class HelpModal {
  private static instance: HelpModal | null = null;
  private overlay: HTMLElement | null = null;

  static getInstance(): HelpModal {
    if (!HelpModal.instance) {
      HelpModal.instance = new HelpModal();
    }
    return HelpModal.instance;
  }

  static toggle(): void {
    const modal = HelpModal.getInstance();
    if (modal.isOpen()) {
      modal.close();
    } else {
      modal.open();
    }
  }

  isOpen(): boolean {
    return this.overlay !== null;
  }

  open(): void {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.id = 'help-modal-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(10, 14, 20, 0.85);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const panel = document.createElement('div');
    panel.id = 'help-modal-panel';
    panel.style.cssText = `
      background: #141b24;
      border: 1px solid #4ecdc4;
      border-radius: 16px;
      width: min(720px, 94vw);
      max-height: 88vh;
      overflow-y: auto;
      padding: 24px;
      color: #e2e8f0;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(78, 205, 196, 0.25); padding-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(78, 205, 196, 0.15); border: 1px solid #4ecdc4; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
            📖
          </div>
          <div>
            <h2 style="margin: 0; font-size: 1.3rem; color: #4ecdc4;">HavenWorld Citizen Guide &amp; Controls</h2>
            <div style="font-size: 0.82rem; color: #94a3b8;">Controls, shortcuts, and gameplay mechanics walkthrough</div>
          </div>
        </div>
        <button id="btn-close-help" style="background: transparent; border: none; color: #94a3b8; font-size: 1.5rem; cursor: pointer; padding: 4px 8px; border-radius: 6px;">✕</button>
      </div>

      <!-- Quick Shortcuts Grid -->
      <div style="margin-bottom: 20px;">
        <h3 style="font-size: 0.95rem; color: #38bdf8; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.5px;">⌨️ Keyboard Shortcuts</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
          <div style="background: #1e2632; padding: 10px 12px; border-radius: 8px; border: 1px solid #2d3748; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.85rem; color: #cbd5e1;">Move Avatar</span>
            <kbd style="background: #2a3444; color: #4ecdc4; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-family: monospace;">WASD / Click</kbd>
          </div>
          <div style="background: #1e2632; padding: 10px 12px; border-radius: 8px; border: 1px solid #2d3748; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.85rem; color: #cbd5e1;">Sit / Stand</span>
            <kbd style="background: #2a3444; color: #4ecdc4; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-family: monospace;">Space</kbd>
          </div>
          <div style="background: #1e2632; padding: 10px 12px; border-radius: 8px; border: 1px solid #2d3748; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.85rem; color: #cbd5e1;">Rotate Furniture</span>
            <kbd style="background: #2a3444; color: #4ecdc4; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-family: monospace;">R Key</kbd>
          </div>
          <div style="background: #1e2632; padding: 10px 12px; border-radius: 8px; border: 1px solid #2d3748; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.85rem; color: #cbd5e1;">Emote Wheel</span>
            <kbd style="background: #2a3444; color: #4ecdc4; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-family: monospace;">E Key</kbd>
          </div>
          <div style="background: #1e2632; padding: 10px 12px; border-radius: 8px; border: 1px solid #2d3748; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.85rem; color: #cbd5e1;">Focus Chat</span>
            <kbd style="background: #2a3444; color: #4ecdc4; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-family: monospace;">Enter</kbd>
          </div>
          <div style="background: #1e2632; padding: 10px 12px; border-radius: 8px; border: 1px solid #2d3748; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.85rem; color: #cbd5e1;">Citizen Help</span>
            <kbd style="background: #2a3444; color: #4ecdc4; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-family: monospace;">? / F1</kbd>
          </div>
        </div>
      </div>

      <!-- Gameplay Systems Walkthrough -->
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div style="background: #1a222d; padding: 14px; border-radius: 10px; border-left: 4px solid #4ecdc4;">
          <h4 style="margin: 0 0 6px; font-size: 0.95rem; color: #e2e8f0;">🏠 Personal Sanctuary &amp; Decorator</h4>
          <p style="margin: 0; font-size: 0.82rem; color: #94a3b8; line-height: 1.45;">
            Your personal loft is your private home. Click <strong>Decorate Loft</strong> to enter editor mode. Place furniture instantly with bounding ghosts, rotate items with <strong>R</strong>, customize flooring and wallpaper textures in the <strong>Surfaces</strong> tab, and set ambient lighting presets (Day, Dusk, Night, Cyber Neon).
          </p>
        </div>

        <div style="background: #1a222d; padding: 14px; border-radius: 10px; border-left: 4px solid #f59e0b;">
          <h4 style="margin: 0 0 6px; font-size: 0.95rem; color: #e2e8f0;">💬 Social Interaction &amp; Chat</h4>
          <p style="margin: 0; font-size: 0.82rem; color: #94a3b8; line-height: 1.45;">
            Speak naturally to project in-world speech bubbles above your avatar. Use <code>/w [username] [message]</code> for confidential direct whispers, or <code>/shout [message]</code> to expand your voice radius across the entire venue. Right-click or touch any player to inspect their passport, message, trade, add friend, or block them.
          </p>
        </div>

        <div style="background: #1a222d; padding: 14px; border-radius: 10px; border-left: 4px solid #ec4899;">
          <h4 style="margin: 0 0 6px; font-size: 0.95rem; color: #e2e8f0;">👗 Wardrobe &amp; Authentic 2D Chibi Style</h4>
          <p style="margin: 0; font-size: 0.82rem; color: #94a3b8; line-height: 1.45;">
            Customize your 2D chibi avatar across Tops, Pants, Headwear, Facewear, Backwear (Wings), Eyes, Shoes, and Hair. Strip to the clean underwear base anytime to reset outfits without layer clipping.
          </p>
        </div>

        <div style="background: #1a222d; padding: 14px; border-radius: 10px; border-left: 4px solid #10b981;">
          <h4 style="margin: 0 0 6px; font-size: 0.95rem; color: #e2e8f0;">🎣 Activities, Economy &amp; Trading</h4>
          <p style="margin: 0; font-size: 0.82rem; color: #94a3b8; line-height: 1.45;">
            Fish at the lake in Haven Park to catch rare species and climb weekly leaderboards. Bake customer tickets in the fast-paced Pizza Chef kitchen. Trade items and coins securely with citizens using the dual-confirmation 8-slot trading shelf.
          </p>
        </div>
      </div>
    `;

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
    DraggablePanel.makeDraggable(panel);

    panel.querySelector('#btn-close-help')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
