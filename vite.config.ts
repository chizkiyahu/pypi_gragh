import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [preact()],
  test: {
    environment: 'node',
  },
})
