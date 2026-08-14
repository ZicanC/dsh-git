import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Linked DeepSeek Harness packages must share this repository's React
    // instance, matching the browser module loader's platform singleton.
    dedupe: ['react', 'react-dom'],
  },
})
