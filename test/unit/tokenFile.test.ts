// The token file's failure rules over the real filesystem: a failed setup
// cleans up and reports the fixed token, and removing an already-gone
// directory is moot rather than a failure.
import { mkdtempSync, rmSync } from 'node:fs'
import { rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTokenFile, type TokenWindowsAcl } from '../../src/runtime/tokenFile'

const RECEIPT = {
  ownerSid: 'sid',
  currentSid: 'sid',
  protected: true,
  rules: [{ sid: 'sid', inherited: false, allow: true, fullControl: true }],
}

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'token-file-'))
}

describe('createTokenFile failure rules', () => {
  it('creates a token and removes every trace', async () => {
    const parent = scratch()
    try {
      const created = await createTokenFile(parent)
      expect(created.token.length).toBeGreaterThan(0)
      await created.remove()
      expect(() => {
        rmSync(created.path)
      }).toThrow()
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('reports a failed setup as the fixed token with its cause', async () => {
    const parent = scratch()
    const setup = new Error('EACCES-test')
    const acl: TokenWindowsAcl = {
      secure: () => Promise.reject(setup),
    }
    try {
      let failure: unknown
      try {
        await createTokenFile(parent, acl)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      if (!(failure instanceof Error)) throw new Error('unreachable')
      expect(failure.message).toBe('ETOKEN_ACL')
      expect(failure.cause).toBe(setup)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('treats a directory that vanished mid-cleanup as moot', async () => {
    const parent = scratch()
    const acl: TokenWindowsAcl = {
      secure: (file, isDirectory) => {
        if (!isDirectory) {
          // The file's check finds its directory already gone: the later
          // removal meets ENOENT and still reports the setup failure.
          return (async () => {
            await rmdir(path.dirname(file))
            throw new Error('late')
          })()
        }
        return Promise.resolve(RECEIPT)
      },
    }
    try {
      let failure: unknown
      try {
        await createTokenFile(parent, acl)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      if (!(failure instanceof Error)) throw new Error('unreachable')
      expect(failure.message).toBe('ETOKEN_ACL')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
