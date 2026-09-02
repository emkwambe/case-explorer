import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      // Node for logic and API suites; jsdom only where a DOM is declared per file.
      environment: 'node',
      environmentMatchGlobs: [['src/ui/**', 'jsdom']],
      setupFiles: ['./src/ui/test-setup.js'],
      include: ['src/**/*.test.{js,jsx}', 'tests/**/*.test.{js,jsx}'],
      coverage: {
        provider: 'v8',
        reportsDirectory: 'coverage',
        include: ['src/**/*.{js,jsx}'],
        exclude: ['src/**/*.test.{js,jsx}', 'src/ui/test-setup.js', 'src/main.jsx']
      }
    }
  })
)
