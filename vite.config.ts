import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base so the built app works on any static host sub-path,
// including GitHub Pages project sites (username.github.io/<repo>/).
export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
  };
});
