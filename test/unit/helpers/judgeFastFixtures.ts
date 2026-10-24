// The recorded real tool exchanges the fast judge suites read
// (test/fixtures/judgeFast, captured 2026-10-22).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'judgeFast',
)

/** One recorded exchange's text, by its file name. */
export const judgeFastFixture = (name: string): string =>
  readFileSync(path.join(fixtureRoot, name), 'utf8')
