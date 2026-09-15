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
  server: {
    // Dev: proxy to Vite dev server for HMR. Prod: serve from dist/.
    ...(process.env.NODE_ENV === 'development'
      ? { url: 'http://localhost:5173', clearContext: true }
      : { url: 'http://localhost:3000' }),
  },
  ios: {
    // WKWebView full-screen (no URL bar, no overscroll)
    backgroundColor: '#000000',
    // URL scheme for App Store compliance (no "miniworld" naming)
    scheme: 'haveworld',
  },
  android: {
    backgroundColor: '#000000',
  },
};
