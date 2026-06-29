import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@personal-assistant/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
})
