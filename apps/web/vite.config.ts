import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Ink 950 de la marca: el fondo oscuro de la aplicación y el del icono de
 * producto. Lo comparten el manifest y el splash de la PWA.
 */
const THEME_COLOR = '#080B14';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'health.txt'],
      manifest: {
        name: 'Vega',
        short_name: 'Vega',
        description: 'Corrección asistida de exámenes de matemáticas manuscritos.',
        lang: 'es-ES',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: THEME_COLOR,
        theme_color: THEME_COLOR,
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Los escaneos son grandes: no los precacheamos, se sirven desde el API.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,txt}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // `@vega/shared` se publica como TypeScript en crudo dentro del monorepo:
  // si esbuild lo pre-empaqueta, los cambios en el contrato no se recargan.
  optimizeDeps: {
    exclude: ['@vega/shared'],
  },
  build: {
    // KaTeX y sus fuentes casi nunca cambian: en un chunk aparte para que una
    // actualización de la aplicación no invalide 250 kB de caché del móvil.
    rollupOptions: {
      output: {
        manualChunks: {
          katex: ['katex'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // Loopback IPv4 explícito. El default de Vite (`localhost`) sólo levanta
    // `[::1]`, y el proxy de `tailscale serve` entra por `127.0.0.1`. Atarlo
    // aquí sirve a ambos sin exponer el puerto en la red local.
    host: '127.0.0.1',
    // Vite 6 rechaza cabeceras `Host` que no reconoce. Las IP pasan el filtro,
    // pero los nombres MagicDNS (`*.ts.net`) no; el punto inicial cubre el tailnet.
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
});
