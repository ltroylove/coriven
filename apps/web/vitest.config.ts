import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // The React plugin provides JSX transform for component tests.
  // It has no effect on the existing API-route test (pure TypeScript, node env).
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@personal-assistant/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
  test: {
    // Default environment for API-route tests (node). Component tests override
    // this per-file with the `// @vitest-environment jsdom` pragma at the top.
    environment: 'node',
    // globals: true exposes expect/describe/it/vi globally so that
    // @testing-library/jest-dom can extend `expect` during setup.
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
})
