import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project sites serve from /<repo>/. Getting this wrong 404s every asset.
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/uke-learner/' : '/',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
