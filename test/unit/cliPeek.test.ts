import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CliAccount } from '../../src/host/auth/cliAccount'
import type { Logger } from '../../src/host/logger'

const log: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

function accountFor(file: string): CliAccount {
  return new CliAccount({
    platform: 'linux',
    credentialFilePath: () => file,
    probe: () => Promise.resolve(undefined),
    log,
  })
}

describe('credential file peek', () => {
  it('reads signed-out where there is no file, without starting a process', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'peek-'))
    dirs.push(dir)
    expect(accountFor(path.join(dir, 'auth.json')).peekFile()).toBe('signedOut')
  })

  it('reads signed-in from a captured inline shape, without asking the CLI', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'peek-'))
    dirs.push(dir)
    // The value is a dummy placeholder, never a credential (F94: the parse
    // reads a sign-in only from a string `api_key`; a non-string is left to
    // the CLI).
    const file = path.join(dir, 'auth.json')
    writeFileSync(file, '{"schema_version":1,"providers":{"meta":{"api_key":"key-for-tests"}}}')
    expect(accountFor(file).peekFile()).toBe('signedIn')
  })

  it('settles nothing the file cannot say', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'peek-'))
    dirs.push(dir)
    const file = path.join(dir, 'auth.json')
    writeFileSync(file, 'not json at all')
    expect(accountFor(file).peekFile()).toBeUndefined()
  })
})
