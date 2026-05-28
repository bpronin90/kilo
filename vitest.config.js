import { defineConfig, defaultExclude } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    exclude: [...defaultExclude, 'mobile/**'],
  },
})
