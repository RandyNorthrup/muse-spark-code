// The credential file's structure read (src/host/auth/cliAccount.ts) is
// kept as it is: a path that is not there reads as no file, while a path
// that is there but unreadable reads as unrecognized — never as absent,
// so an unreadable credential can never pass for signed out. The failures
// below are the operating system's own, through the real reader.
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { readCredentialFile } from '../../src/host/auth/cliAccount'
import { MUSE_CREDENTIAL_FILE_MAX_BYTES } from '../../src/shared/constants'

const INLINE_FILE = readFileSync(
  new URL('../fixtures/maccred/v1-auth-set.json', import.meta.url),
  'utf8',
)

it('a missing file reads as no file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-credential-'))
  expect(readCredentialFile(path.join(dir, 'muse.json'), 'linux')).toBeUndefined()
})

it('a directory reads as unrecognized, never as absent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-credential-'))
  expect(readCredentialFile(dir, 'linux')).toEqual({
    signature: 'unreadable',
    verdict: 'unrecognized',
  })
})

it('a file the structure cannot place reads as unrecognized', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-credential-'))
  const file = path.join(dir, 'muse.json')
  await writeFile(file, 'not json at all')
  const reading = readCredentialFile(file, 'linux')
  expect(reading?.verdict).toBe('unrecognized')
  expect(reading?.signature).toContain(':')
})

it('an unreadable path reads as unrecognized, never as absent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-credential-'))
  const first = path.join(dir, 'first')
  const second = path.join(dir, 'second')
  try {
    await symlink(second, first)
    await symlink(first, second)
  } catch {
    // No links on this host; the cases above still pin the distinction.
    return
  }
  let code: string | undefined
  try {
    statSync(first)
  } catch (error: unknown) {
    code = error instanceof Error && 'code' in error ? String(error.code) : undefined
  }
  expect(code).toBeDefined()
  const isMissing = code === 'ENOENT' || code === 'ENOTDIR'
  expect(readCredentialFile(first, 'linux')).toEqual(
    isMissing ? undefined : { signature: 'unreadable', verdict: 'unrecognized' },
  )
})

it('a symlink is not the credential file it points at', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-credential-'))
  try {
    const target = path.join(dir, 'real.json')
    const link = path.join(dir, 'auth.json')
    await writeFile(target, INLINE_FILE)
    try {
      await symlink(target, link)
    } catch {
      return
    }
    const followed = readCredentialFile(target, 'darwin')
    const linked = readCredentialFile(link, 'darwin')
    expect(followed?.verdict).toBe('inline')
    expect(linked).toEqual({ signature: 'unreadable', verdict: 'unrecognized' })
    expect(JSON.stringify(linked)).not.toContain('api_key')
    expect(JSON.stringify(linked)).not.toContain('<placeholder>')
    await symlink('missing-target.json', path.join(dir, 'dangling.json'))
    expect(readCredentialFile(path.join(dir, 'dangling.json'), 'darwin')).toEqual({
      signature: 'unreadable',
      verdict: 'unrecognized',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('an oversized credential file is not read as a sign-in', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-credential-'))
  try {
    const file = path.join(dir, 'auth.json')
    await writeFile(file, 'x'.repeat(MUSE_CREDENTIAL_FILE_MAX_BYTES + 1))
    const reading = readCredentialFile(file, 'darwin')
    expect(reading?.verdict).toBe('unrecognized')
    expect(reading?.signature.startsWith(`${String(MUSE_CREDENTIAL_FILE_MAX_BYTES + 1)}:`)).toBe(
      true,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
