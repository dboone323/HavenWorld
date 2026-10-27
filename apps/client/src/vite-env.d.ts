/// <reference types="vite/client" />

/**
 * Typed Vite environment variables used by the HavenWorld client.
 * Declared explicitly so `import.meta.env` is fully typed under `strict` mode.
 */
interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_ASSET_BASE_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export interface HavenMeshMetadata {
  isLocalAvatar?: boolean;
  isRemoteAvatar?: boolean;
  userId?: string;
  username?: string;
  interactive?: boolean;
  furniture?: boolean;
  itemId?: string;
  id?: string;
  triggerType?: string;
}

declare global {
  interface Window {
    __havenRoomReady?: boolean;
    __havenRoomId?: string;
    __havenAvatarController?: unknown;
    __havenEngine?: unknown;
    __havenSceneManager?: unknown;
    __havenAuthService?: unknown;
    __havenSocket?: unknown;
    __havenAvatarContextMenu?: unknown;
    __havenFurnitureManager?:
      | import('./world/FurnitureManager').FurnitureManager
      | {
          pickFurniture?: (
            pick: import('@babylonjs/core').PickingInfo
          ) => import('./world/FurnitureManager').PlacedFurniture | null;
        };
    __HAVEN_DEV__?: boolean;
    webkitAudioContext?: typeof AudioContext;
  }
}