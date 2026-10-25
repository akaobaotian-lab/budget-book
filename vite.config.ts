import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages などサブパスでも動くよう相対パスで出力
  base: './',
});
