import { defineConfig } from 'vite';

/**
 * vite.config.js
 *
 * MediaPipe packages (@mediapipe/hands, @mediapipe/camera_utils) are
 * distributed as UMD/IIFE bundles that write onto window globals — they are
 * NOT proper ES modules.  We tell Rolldown/Rollup to treat them as external
 * and map them to the globals injected by the CDN <script> tags in index.html.
 *
 * HTTP (no SSL) is intentional for Android development:
 *   - The Even App WebView on Android rejects self-signed certs hard, causing
 *     a completely blank page before any JS runs.
 *   - Android does not require HTTPS for DeviceOrientationEvent (only iOS 13+).
 *   - Camera access via getUserMedia works over HTTP on localhost/LAN in
 *     Android WebView when the app grants the permission natively.
 */
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: false,
    // allowedHosts: true (boolean) is required to bypass Vite 8's host
    // validation middleware. 'all' (string) does NOT work — only strict true.
    // The guard in Vite 8 source is:
    //   if (allowedHosts !== true && !serverConfig.https) { block }
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      external: ['@mediapipe/hands', '@mediapipe/camera_utils'],
      output: {
        globals: {
          '@mediapipe/hands':        'window',
          '@mediapipe/camera_utils': 'window',
        },
      },
    },
  },
});
