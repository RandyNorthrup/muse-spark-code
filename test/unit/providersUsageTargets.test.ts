// RLTESTDRIVE2 14: bare `providers usage` names the missing id and lists
// the configured ids instead of answering "Unknown argument". The parse
// pins both forms; the handler reads a real providers file through the
// real reader, so only a genuinely configured id is ever listed.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { ACP_AGENT_NAME, PROVIDER_SPEND_DAYS_DEFAULT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'
import { readProvidersFile } from '../../src/core/providers/providersFile'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { providersUsageTargets, type ProvidersDeps } from '../../src/runtime/providersCommands'

function providersFile(names: readonly string[]): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'providers-usage-'))
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true })
  })
  const file = path.join(folder, 'providers.json')
  writeFileSync(
    file,
    JSON.stringify({
      v: 1,
      providers: names.map((id) => ({
        id,
        preset: 'anthropic',
        address: 'https://api.anthropic.com',
        format: 'anthropic',
        auth: 'apiKey',
        models: ['claude-opus-4-6'],
      })),
    }),
  )
  return file
}

function depsFor(file: string, lines: string[]): ProvidersDeps {
  return {
    readUserFile: () => readProvidersFile(file, (name) => readFile(name, 'utf8')),
    writeUserFile: () => Promise.resolve(false),
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
    resolveHost: () => Promise.resolve([]),
    fetch,
    readSecret: () => Promise.resolve(''),
    print: (line) => {
      lines.push(line)
    },
    printError: () => undefined,
  }
}

describe('providers usage without an id', () => {
  it('parses to the id list with no provider', () => {
    expect(parseCommandLine(['providers', 'usage'])).toEqual({ command: 'providersUsageTargets' })
    // The id form is RLM95's spend report; the misuses keep their shapes.
    expect(parseCommandLine(['providers', 'usage', 'openrouter'])).toEqual({
      command: 'providersUsage',
      provider: 'openrouter',
      days: PROVIDER_SPEND_DAYS_DEFAULT,
      json: false,
    })
    expect(parseCommandLine(['providers', 'usage', 'a', 'b'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
    expect(parseCommandLine(['providers', 'usage', 'not an id'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
  })

  it('names the missing id and lists the configured ids, exit 2', async () => {
    const lines: string[] = []
    const exit = await providersUsageTargets(depsFor(providersFile(['testprov', 'testtwo']), lines))
    expect(exit).toBe(2)
    expect(lines).toEqual([
      fill(EN.providerUsageNeedsId, { command: ACP_AGENT_NAME }),
      'testprov',
      'testtwo',
    ])
  })

  it('says so when no provider is configured, exit 2', async () => {
    const lines: string[] = []
    const exit = await providersUsageTargets(depsFor(providersFile([]), lines))
    expect(exit).toBe(2)
    expect(lines).toEqual([
      fill(EN.providerUsageNeedsId, { command: ACP_AGENT_NAME }),
      EN.providersNoneFound,
    ])
  })
})
