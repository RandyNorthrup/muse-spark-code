import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

describe('M118 integration artifacts', () => {
  it('keeps all portable JSON schemas in sync with the production boundaries', async () => {
    const { stdout } = await run(process.execPath, ['scripts/exec-schema.mjs', '--check'])
    expect(stdout).toContain('Exec schemas match.')
  })
})
