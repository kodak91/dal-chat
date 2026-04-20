import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'

// 빌드 후 firebase-messaging-sw.js의 __VITE_*__ 플레이스홀더를 실제 env 값으로 교체
function injectFcmSwEnv() {
  return {
    name: 'inject-fcm-sw-env',
    closeBundle() {
      const swPath = path.resolve('dist/firebase-messaging-sw.js');
      if (!fs.existsSync(swPath)) return;
      let content = fs.readFileSync(swPath, 'utf8');
      const vars = [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_MESSAGING_SENDER_ID',
        'VITE_FIREBASE_APP_ID',
      ];
      for (const key of vars) {
        content = content.replaceAll(`__${key}__`, process.env[key] ?? '');
      }
      fs.writeFileSync(swPath, content);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
    injectFcmSwEnv(),
  ],
})
