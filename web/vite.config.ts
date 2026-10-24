import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';


export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@causa/types': new URL('../server/src/types.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') } },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8700', changeOrigin: true } } },
});
