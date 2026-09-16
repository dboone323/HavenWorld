/**
 * HavenWorld — Capacitor config (Capacitor 7).
 *
 * Capacitor 7 no longer exports defineConfig from @capacitor/cli;
 * the config is a plain object exported as default.
 */
export default {
  appId: 'com.havenworld.game',
  appName: 'HavenWorld',
  webDir: 'dist',
  // In development, load from Vite dev server for HMR.
  // In production, load from the bundled local assets (no server URL).
  ...(process.env.NODE_ENV === 'development' && {
    server: {
      url: 'http://localhost:5173',
      clearContext: true,
    },
  }),
  ios: {
    backgroundColor: '#000000',
    scheme: 'haveworld',
  },
  android: {
    backgroundColor: '#000000',
  },
};
