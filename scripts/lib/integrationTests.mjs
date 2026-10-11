import { readdirSync } from 'node:fs'
import path from 'node:path'

const INTEGRATION_TEST_DIR = 'test/integration'

// Shared by the dev build and its dependency-cycle root coverage guard.
export function listIntegrationTests() {
  return readdirSync(INTEGRATION_TEST_DIR, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => path.join(INTEGRATION_TEST_DIR, name))
}
