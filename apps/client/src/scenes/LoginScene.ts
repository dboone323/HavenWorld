import Phaser from 'phaser';

/**
 * LoginScene — simply reveals the HTML #login-panel.
 * All login logic lives in loginUI.ts which mounts on DOMContentLoaded.
 */
export class LoginScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LoginScene' });
  }

  create(): void {
    document.getElementById('login-panel')?.classList.remove('hidden');
    document.getElementById('lobby-panel')?.classList.add('hidden');
    document.getElementById('game-container')?.classList.add('hidden');
  }
}
