import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectManifest: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        includeAssets: [
          'assets/images/icon.png',
          'assets/images/logo.png',
          'assets/images/favicon-16x16.png',
          'assets/images/favicon-32x32.png',
          'assets/images/apple-touch-icon.png',
        ],
        manifest: {
          name: 'Collabsuite - Gerenciador de Projetos e Agenda',
          short_name: 'Collabsuite',
          description:
            'Sistema completo para gerenciar projetos, tarefas (Kanban), reuniões e agenda integrada, com colaboração em tempo real.',
          theme_color: '#0B0B0D',
          background_color: '#0B0B0D',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          lang: 'pt-BR',
          categories: ['productivity', 'business'],
          icons: [
            {
              src: '/assets/images/pwa-64x64.png',
              sizes: '64x64',
              type: 'image/png',
            },
            {
              src: '/assets/images/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/assets/images/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/assets/images/pwa-maskable-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/assets/images/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Terminal SSH: pré-otimiza o xterm. Sem isto o Vite o "descobre" no primeiro acesso e recarrega a página no meio da sessão.
    optimizeDeps: {
      include: ['@xterm/xterm', '@xterm/addon-fit'],
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            if (id.includes('node_modules/react-router') || id.includes('node_modules/react-dom') || id.match(/node_modules\/react\//)) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3')) {
              return 'vendor-recharts';
            }
            if (id.includes('node_modules/@tiptap') || id.includes('node_modules/prosemirror')) {
              return 'vendor-editors';
            }
            if (id.includes('node_modules/@fortawesome')) {
              return 'vendor-fa';
            }
            if (id.includes('node_modules/@radix-ui')) {
              return 'vendor-radix';
            }
            if (id.includes('node_modules/xlsx') || id.includes('node_modules/jspdf') || id.includes('node_modules/jspreadsheet') || id.includes('node_modules/jsuites') || id.includes('node_modules/file-saver') || id.includes('node_modules/html2canvas')) {
              return 'vendor-data';
            }
            if (id.includes('node_modules/motion') || id.includes('node_modules/tippy.js')) {
              return 'vendor-anim';
            }
            if (id.includes('node_modules/@excalidraw')) {
              return 'vendor-excalidraw';
            }
            if (id.includes('node_modules/socket.io')) {
              return 'vendor-socket';
            }
            if (id.includes('node_modules/zustand') || id.includes('node_modules/axios') || id.includes('node_modules/zod') || id.includes('node_modules/clsx') || id.includes('node_modules/tailwind-merge') || id.includes('node_modules/class-variance-authority') || id.includes('node_modules/lucide')) {
              return 'vendor-utils';
            }
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
