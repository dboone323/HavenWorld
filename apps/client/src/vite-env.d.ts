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