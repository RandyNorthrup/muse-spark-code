import { defineConfig, mergeConfig } from 'vitest/config'
import repository from '../../../vitest.config.ts'

export default mergeConfig(
  repository,
  defineConfig({ test: { include: ['test/m104/ui/**/*.test.{ts,tsx,mjs}'] } }),
)
