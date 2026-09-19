import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Two entry points, fixed output names.
 *
 * `sidepanel.html` is a normal page bundle. `background.ts` is emitted as an
 * ES module at a stable path, because manifest.json names it directly and
 * MV3 loads it with `"type": "module"`. Hashed filenames would break that,
 * so entryFileNames is pinned.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, 'sidepanel.html'),
        background: path.resolve(__dirname, 'src/background.ts'),
        options: path.resolve(__dirname, 'options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
