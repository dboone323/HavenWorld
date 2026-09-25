import * as BABYLON from '@babylonjs/core';
import { socketService } from '../services/socket';
import { SOCKET_EVENTS, type ChatMessage } from '@havenworld/shared';
import { authService } from '../services/auth';

interface ActiveBubble {
  element: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  fadeTimer?: ReturnType<typeof setTimeout>;
  userId: string;
  getTargetPosition: () => BABYLON.Vector3 | null;
}

export class InWorldSpeechBubbles {
  private static instance: InWorldSpeechBubbles | null = null;
  private bubbles: Map<string, ActiveBubble> = new Map();
  private scene: BABYLON.Scene | null = null;
  private renderObserver: BABYLON.Observer<BABYLON.Scene> | null = null;
  private localAvatarGetter?: () => BABYLON.Vector3 | null;
  private remoteAvatarGetters: Map<string, () => BABYLON.Vector3 | null> = new Map();

  private constructor() {
    this.setupSocketListener();
  }

  static getInstance(): InWorldSpeechBubbles {
    if (!InWorldSpeechBubbles.instance) {
      InWorldSpeechBubbles.instance = new InWorldSpeechBubbles();
    }
    return InWorldSpeechBubbles.instance;
  }

  attachScene(scene: BABYLON.Scene): void {
    this.detachScene();
    this.scene = scene;
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      this.updatePositions();
    });
  }

  detachScene(): void {
    if (this.scene && this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.clearAll();
    this.scene = null;
  }

  registerLocalAvatar(getPosition: () => BABYLON.Vector3 | null): void {
    this.localAvatarGetter = getPosition;
  }

  registerRemoteAvatar(userId: string, getPosition: () => BABYLON.Vector3 | null): void {
    this.remoteAvatarGetters.set(userId, getPosition);
  }

  unregisterRemoteAvatar(userId: string): void {
    this.remoteAvatarGetters.delete(userId);
    this.removeBubble(userId);
  }

  private setupSocketListener(): void {
    socketService.on<ChatMessage>(SOCKET_EVENTS.CHAT_MESSAGE, (msg) => {
      if (!msg) return;
      const userId = msg.senderId || msg.playerId || authService.user?.id || '';
      const name = msg.senderName || msg.username || authService.user?.username || 'Citizen';
      const text = msg.text || msg.content || '';
      if (!userId || !text) return;
      this.showBubble(userId, name, text);
    });
  }

  showBubble(userId: string, senderName: string, text: string): void {
    if (typeof document === 'undefined') return;

    // Remove any previous bubble for this user
    this.removeBubble(userId);

    const isSelf =
      userId === authService.user?.id ||
      (authService.user?.username && senderName === authService.user.username) ||
      !this.remoteAvatarGetters.has(userId);

    const targetGetter = isSelf
      ? this.localAvatarGetter
      : this.remoteAvatarGetters.get(userId) || this.localAvatarGetter;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'mp-bubble';
    bubbleEl.innerHTML = `
      <strong>${this.escape(senderName)}</strong>
      <span>${this.escape(text)}</span>
    `;
    document.body.appendChild(bubbleEl);

    // Initial position
    this.positionBubbleElement(bubbleEl, targetGetter ? targetGetter() : null);

    const timer = setTimeout(() => {
      bubbleEl.style.opacity = '0';
      bubbleEl.style.transform = 'translate(-50%, -115%) scale(0.95)';
      const fadeTimer = setTimeout(() => {
        bubbleEl.remove();
        this.bubbles.delete(userId);
      }, 300);
      const b = this.bubbles.get(userId);
      if (b) b.fadeTimer = fadeTimer;
    }, 6000);

    this.bubbles.set(userId, {
      element: bubbleEl,
      timer,
      userId,
      getTargetPosition: targetGetter || (() => null),
    });
  }

  private updatePositions(): void {
    if (!this.scene) return;
    this.bubbles.forEach((b) => {
      const pos = b.getTargetPosition();
      this.positionBubbleElement(b.element, pos);
    });
  }

  private positionBubbleElement(el: HTMLElement, worldPos: BABYLON.Vector3 | null): void {
    if (!worldPos || !this.scene || !this.scene.activeCamera) {
      el.style.display = 'block';
      el.style.left = '50%';
      el.style.top = '35%';
      return;
    }

    const camera = this.scene.activeCamera;
    const engine = this.scene.getEngine();
    // Offset above avatar's head (avatar height is ~2.10m, place bubble at 2.45m)
    const headPos = new BABYLON.Vector3(worldPos.x, worldPos.y + 2.45, worldPos.z);

    const screenPos = BABYLON.Vector3.Project(
      headPos,
      BABYLON.Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
    );

    const canvas = engine.getRenderingCanvas();
    const rect = canvas
      ? canvas.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    const clientX = rect.left + (screenPos.x / engine.getRenderWidth()) * rect.width;
    const clientY = rect.top + (screenPos.y / engine.getRenderHeight()) * rect.height;

    // Only render if in front of camera
    if (screenPos.z > 0 && screenPos.z < 1) {
      el.style.display = 'block';
      el.style.left = `${Math.round(clientX)}px`;
      el.style.top = `${Math.round(clientY)}px`;
    } else {
      el.style.display = 'none';
    }
  }

  private removeBubble(userId: string): void {
    const b = this.bubbles.get(userId);
    if (!b) return;
    clearTimeout(b.timer);
    if (b.fadeTimer) clearTimeout(b.fadeTimer);
    b.element.remove();
    this.bubbles.delete(userId);
  }

  private clearAll(): void {
    this.bubbles.forEach((b) => {
      clearTimeout(b.timer);
      if (b.fadeTimer) clearTimeout(b.fadeTimer);
      b.element.remove();
    });
    this.bubbles.clear();
  }

  private escape(str: string): string {
    const p = document.createElement('p');
    p.textContent = str;
    return p.innerHTML;
  }
}
