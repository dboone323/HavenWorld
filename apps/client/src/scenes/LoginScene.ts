import { Scene, Color4 } from '@babylonjs/core';
import { HavenEngine } from '../engine/HavenEngine';

export async function createLoginScene(haven: HavenEngine): Promise<Scene> {
  const scene = new Scene(haven.engine);
  scene.clearColor = new Color4(0.1, 0.1, 0.18, 1.0);

  document.getElementById('login-panel')?.classList.remove('hidden');
  document.getElementById('lobby-panel')?.classList.add('hidden');
  document.getElementById('game-container')?.classList.add('hidden');
  document.getElementById('room-nav')?.classList.add('hidden');
  document.getElementById('player-card')?.classList.add('hidden');
  document.getElementById('chat-panel')?.classList.add('hidden');
  document.getElementById('avatar-panel')?.classList.add('hidden');

  scene.onDisposeObservable.add(() => {
    document.getElementById('login-panel')?.classList.add('hidden');
  });

  return scene;
}
