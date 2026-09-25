import { socketService } from '../services/socket';
import { SOCKET_EVENTS, type PetType } from '@havenworld/shared';
import { showToast } from './ToastNotification';
import { audioEngine } from '../audio/AudioEngine';

export class PetManagementPanel {
  private static overlay: HTMLElement | null = null;

  static async show(): Promise<void> {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'pet-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1e1e38; border: 1px solid rgba(255,255,255,0.18);
      border-radius: 16px; width: 400px; max-height: 85vh; overflow-y: auto;
      color: #fff; padding: 24px; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
    `;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
        <h2 style="margin:0; font-size:1.25rem;">🐾 Pet Companions</h2>
        <button id="pet-panel-close" style="background:none; border:none; color:#aaa; font-size:1.4rem; cursor:pointer;">✕</button>
      </div>

      <div id="pet-panel-content">
        <p style="color:rgba(255,255,255,0.7); font-size:0.9rem; margin-bottom:16px;">
          Adopt and take care of your very own companion in HavenWorld!
        </p>

        <div style="background:rgba(255,255,255,0.05); padding:16px; border-radius:12px; margin-bottom:16px;">
          <h3 style="margin:0 0 12px; font-size:1rem;">Adopt a New Pet</h3>
          <div style="display:flex; gap:10px; margin-bottom:12px;">
            <select id="pet-type-select" style="
              flex:1; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2);
              border-radius:8px; color:#fff; padding:8px 12px; font-size:0.9rem;
            ">
              <option value="CAT">🐱 Cat</option>
              <option value="DOG">🐶 Dog</option>
              <option value="BABY_DRAGON">🐲 Baby Dragon</option>
            </select>
            <input id="pet-name-input" type="text" placeholder="Pet Name" maxlength="16" style="
              flex:1; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2);
              border-radius:8px; color:#fff; padding:8px 12px; font-size:0.9rem;
            " />
          </div>
          <button id="btn-adopt-pet" style="
            width:100%; background:linear-gradient(135deg, #10b981 0%, #059669 100%);
            border:none; border-radius:8px; color:#fff; padding:10px; font-weight:600; cursor:pointer;
          ">Adopt Pet</button>
        </div>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    panel.querySelector('#pet-panel-close')?.addEventListener('click', () => {
      audioEngine.playClick();
      this.dismiss();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismiss();
    });

    panel.querySelector('#btn-adopt-pet')?.addEventListener('click', () => {
      const type = (panel.querySelector('#pet-type-select') as HTMLSelectElement).value as PetType;
      const name = (panel.querySelector('#pet-name-input') as HTMLInputElement).value.trim();
      if (!name) {
        audioEngine.playError();
        showToast({
          icon: '⚠️',
          title: 'Pet Name Required',
          subtitle: 'Please give your new companion a name.',
        });
        return;
      }
      audioEngine.playPetHappy();
      socketService.emit(SOCKET_EVENTS.ADOPT_PET, { petType: type, name });
      showToast({
        icon: '🐾',
        title: 'Pet Adopted!',
        subtitle: `You welcomed ${name} to HavenWorld!`,
      });
      this.dismiss();
    });
  }

  static dismiss(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
