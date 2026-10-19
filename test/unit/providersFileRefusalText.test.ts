// REVCATCHF: an unreadable providers file names its failure, not just its
// path. Both person-facing renderers below read the real refusal (a real
// directory read fails on every platform), so the expected words come from
// the genuine failure, never an invented one.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { readProvidersFile, type ProvidersFileRead } from '../../src/core/providers/providersFile'
import { assembleProviderRun } from '../../src/runtime/exec/providerExec'
import { providersList, type ProvidersDeps } from '../../src/runtime/providersCommands'

/** A real folder standing in for the providers file: reading it genuinely fails. */
function unreadableFile(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'providers-refusal-'))
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true })
  })
  return folder
}

/** The refusal a real failed read ends in (never ENOENT, so never `missing`). */
async function refusal(filePath: string): Promise<Extract<ProvidersFileRead, { ok: false }>> {
  const read = await readProvidersFile(filePath, (file) => readFile(file, 'utf8'))
  if (read.ok) throw new Error('expected a refusal')
  expect(read.reason).toBe('unparseable')
  return read
}

const secrets: SecretStore = {
  get: () => Promise.resolve(undefined),
  store: () => Promise.resolve(),
  delete: () => Promise.resolve(),
}

function listDeps(filePath: string, errors: string[]): ProvidersDeps {
  return {
    readUserFile: () => readProvidersFile(filePath, (file) => readFile(file, 'utf8')),
    writeUserFile: () => Promise.resolve(false),
    secrets,
    resolveHost: () => Promise.resolve([]),
    fetch,
    readSecret: () => Promise.resolve(''),
    print: () => undefined,
    printError: (line) => {
      errors.push(line)
    },
  }
}

describe('unreadable providers file text', () => {
  it('tells the providers list the read failure behind the path', async () => {
    const filePath = unreadableFile()
    const failed = await refusal(filePath)
    const causeText = failed.cause instanceof Error ? failed.cause.message : String(failed.cause)
    const errors: string[] = []
    expect(await providersList(listDeps(filePath, errors))).toBe(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(filePath)
    // A bare path never tells the person whether to fix permissions or the
    // text: the OS failure rides along.
    expect(errors[0]).toContain(causeText)
  })

  it('tells an assembled provider run the read failure behind the path', async () => {
    const filePath = unreadableFile()
    const failed = await refusal(filePath)
    const causeText = failed.cause instanceof Error ? failed.cause.message : String(failed.cause)
    const assembled = await assembleProviderRun({
      filePath,
      readFile: (file) => readFile(file, 'utf8'),
      secrets,
      resolveHost: () => Promise.resolve([]),
      readKey: () => Promise.resolve({ ok: false, reason: 'no key' }),
      providerId: 'openai',
      model: undefined,
      keyFromStdin: false,
      baseFetch: fetch,
    })
    if (assembled.ok) throw new Error('expected a usage failure')
    expect(assembled.failure.kind).toBe('usage')
    expect(assembled.failure.reason).toContain(filePath)
    expect(assembled.failure.reason).toContain(causeText)
  })

  it('still names only the file for malformed text', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'providers-refusal-'))
    onTestFinished(() => {
      rmSync(folder, { recursive: true, force: true })
    })
    const filePath = path.join(folder, 'providers.json')
    writeFileSync(filePath, '{oops')
    const errors: string[] = []
    expect(await providersList(listDeps(filePath, errors))).toBe(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(filePath)
  })
})
