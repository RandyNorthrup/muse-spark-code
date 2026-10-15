// D108: `providers models` edits an entry's model list through the same
// validated atomic file the panel writes, with a real providers file in a
// temp folder. Only real modules run here: parser, command, file IO,
// memory secret store, DNS, fetch and stdin reader. A closed local port
// gives a real connection refusal; nothing answers as a provider.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import french from '../../l10n/ui.fr.json'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import {
  emptyProvidersFile,
  readProvidersFile,
  writeProvidersFileAtomic,
  type ProviderEntry,
  type ProvidersFile,
} from '../../src/core/providers/providersFile'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { memorySecretStoreFor } from '../../src/runtime/exec/keyInput'
import {
  resolveEndpointHost,
  userFileIo,
  type ProvidersDeps,
} from '../../src/runtime/providersCommands'
import { readSecretLine } from '../../src/runtime/hiddenInput'
import { providersModels } from '../../src/runtime/providersModelsCommand'
import { UI_TEXT } from '../../src/shared/constants'

const folders: string[] = []

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function entry(
  models: readonly string[] = ['model-a'],
  overrides: Partial<ProviderEntry> = {},
): ProviderEntry {
  return {
    id: 'openrouter',
    preset: 'openrouter',
    auth: 'apiKey',
    models: [...models],
    ...overrides,
  }
}

function fileWith(models: readonly string[] = ['model-a']): ProvidersFile {
  return { ...emptyProvidersFile(), providers: [entry(models)] }
}

interface ModelsHarness {
  readonly deps: ProvidersDeps
  readonly printed: string[]
  readonly errors: string[]
  readonly filePath: string
  readonly secretReads: () => number
}

/**
 * Deps over a real providers file in a temp folder. Secrets are the
 * product's own memory store; reads are counted through delegation so the
 * forced-add test proves the key is never read.
 */
function deps(): ModelsHarness {
  const folder = mkdtempSync(path.join(tmpdir(), 'cli-help-models-'))
  folders.push(folder)
  const filePath = path.join(folder, 'providers.json')
  const printed: string[] = []
  const errors: string[] = []
  const store = memorySecretStoreFor({})
  let reads = 0
  const input = new PassThrough()
  input.end()
  return {
    deps: {
      ...userFileIo(filePath),
      secrets: {
        ...store,
        get: (name) => {
          reads += 1
          return store.get(name)
        },
      },
      resolveHost: resolveEndpointHost,
      fetch: globalThis.fetch.bind(globalThis),
      readSecret: (prompt) => readSecretLine(prompt, input, new PassThrough()),
      print: (line) => {
        printed.push(line)
      },
      printError: (line) => {
        errors.push(line)
      },
    },
    printed,
    errors,
    filePath,
    secretReads: () => reads,
  }
}

async function writeInitial(filePath: string, file: ProvidersFile): Promise<void> {
  const written = await writeProvidersFileAtomic(filePath, file)
  if (!written.ok) throw new Error(written.detail)
}

async function readEntry(filePath: string, id = 'openrouter'): Promise<ProviderEntry> {
  const read = await readProvidersFile(filePath)
  if (!read.ok) throw new Error(read.detail)
  const found = read.file.providers.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error('entry is missing after the command')
  return found
}

/** One models command against the openrouter entry. */
function runModels(
  f: ModelsHarness,
  add: readonly string[] = [],
  remove: readonly string[] = [],
  force?: string,
  target = 'openrouter',
): Promise<number> {
  return providersModels(f.deps, { entry: target, add, remove, force })
}

describe('providers models parsing', () => {
  it('parses list, add, remove and force', () => {
    expect(parseCommandLine(['providers', 'models', 'openrouter'])).toEqual({
      command: 'providersModels',
      options: { entry: 'openrouter', add: [], remove: [], force: undefined },
    })
    expect(
      parseCommandLine([
        'providers',
        'models',
        'openrouter',
        '--add',
        'model-b',
        '--remove',
        'model-a',
        '--force',
        'beta access',
      ]),
    ).toEqual({
      command: 'providersModels',
      options: {
        entry: 'openrouter',
        add: ['model-b'],
        remove: ['model-a'],
        force: 'beta access',
      },
    })
  })

  it('refuses a missing entry, a lone --force and an empty flag with exit 2', () => {
    for (const argv of [
      ['providers', 'models'],
      ['providers', 'models', 'openrouter', '--force', 'reason'],
      ['providers', 'models', 'openrouter', '--force', ''],
      ['providers', 'models', 'openrouter', '--add', ''],
      ['providers', 'models', 'openrouter', '--add', 'm', '--force', ' '.repeat(3)],
      ['providers', 'models', 'openrouter', '--add', 'm', '--force', 'ok\nAdded fake to x.'],
    ]) {
      expect(parseCommandLine(argv), argv.join(' ')).toMatchObject({
        command: 'invalid',
        exitCode: 2,
      })
    }
  })
})

/** The list outcome where the provider's own list cannot be read. */
async function expectEntryOnlyList(f: ModelsHarness): Promise<void> {
  expect(await runModels(f)).toBe(0)
  expect(f.printed.join('\n')).toContain('model-a')
  expect(f.printed).toContain(UI_TEXT.cliHelp.modelsUnreadable)
  expect(f.errors).toEqual([])
}

describe('providers models list', () => {
  it('prints forced-model annotations in the installed language', async () => {
    const f = deps()
    await writeInitial(f.filePath, {
      ...emptyProvidersFile(),
      providers: [
        entry(['model-a'], {
          preset: 'retired-preset',
          forcedModels: { 'model-a': 'beta access' },
        }),
      ],
    })
    setUiText({ ...EN, cliHelp: french.cliHelp }, 'fr')
    expect(await runModels(f)).toBe(0)
    expect(f.printed.join('\n')).toContain('model-a (forcé : beta access)')
    expect(f.printed.join('\n')).not.toContain('forced:')
  })

  it('lists the entry models and notes an unreadable provider list without failing', async () => {
    const f = deps()
    await writeInitial(f.filePath, {
      ...emptyProvidersFile(),
      providers: [
        entry(['model-a'], {
          preset: 'lmstudio',
          address: 'http://127.0.0.1:1',
          auth: 'none',
        }),
      ],
    })
    await expectEntryOnlyList(f)
  })

  it('lists an entry whose preset is retired without touching the network', async () => {
    const f = deps()
    await writeInitial(f.filePath, {
      ...emptyProvidersFile(),
      providers: [entry(['model-a'], { preset: 'retired-preset' })],
    })
    await expectEntryOnlyList(f)
    expect(f.secretReads()).toBe(0)
  })

  it('names the closest configured entries for an unknown entry', async () => {
    const f = deps()
    await writeInitial(f.filePath, fileWith())
    expect(await runModels(f, [], [], undefined, 'openrouterx')).toBe(1)
    expect(f.errors.join('\n')).toContain('openrouter')
  })
})

describe('providers models add and remove', () => {
  it('refuses custom-model edits explicitly before probing or changing the file', async () => {
    const f = deps()
    await writeInitial(f.filePath, {
      ...emptyProvidersFile(),
      providers: [
        entry(['model-a'], {
          preset: 'custom',
          address: 'http://127.0.0.1:1',
          format: 'chat',
          auth: 'none',
          modelLimits: { 'model-a': { contextTokens: 128_000, outputTokens: 4096 } },
        }),
      ],
    })
    for (const force of [undefined, 'beta access']) {
      expect(await runModels(f, ['model-b'], [], force)).toBe(1)
      expect(f.errors.at(-1)).toContain('Custom provider model lists are read-only')
      const saved = await readEntry(f.filePath)
      expect(saved.models).toEqual(['model-a'])
    }
    expect(f.secretReads()).toBe(0)
  })

  it('adds an unlisted model with --force, stores the reason, and never reads the key', async () => {
    const f = deps()
    await writeInitial(f.filePath, fileWith(['model-a']))
    expect(await runModels(f, ['model-c'], [], 'beta access')).toBe(0)
    const saved = await readEntry(f.filePath)
    expect(saved.models).toEqual(['model-a', 'model-c'])
    expect(saved.forcedModels).toEqual({ 'model-c': 'beta access' })
    expect(f.secretReads()).toBe(0)
    expect(f.errors).toEqual([])
  })

  it('adds a repeated --add once, never twice in the file', async () => {
    const f = deps()
    await writeInitial(f.filePath, fileWith(['model-a']))
    expect(await runModels(f, ['model-c', 'model-c'], [], 'beta access')).toBe(0)
    const saved = await readEntry(f.filePath)
    expect(saved.models).toEqual(['model-a', 'model-c'])
    expect(f.printed.join('\n')).toContain('Added model-c to openrouter.')
  })

  it('keeps a model another writer added between the read and the commit', async () => {
    const f = deps()
    await writeInitial(f.filePath, fileWith(['model-a']))
    // After the command's first read, a real second write of the same file
    // (the panel's) adds model-b; the commit must not lose it.
    const realRead = f.deps.readUserFile
    let reads = 0
    const racing: ProvidersDeps = {
      ...f.deps,
      readUserFile: async () => {
        const read = await realRead()
        reads += 1
        if (reads === 1) await writeInitial(f.filePath, fileWith(['model-a', 'model-b']))
        return read
      },
    }
    expect(
      await providersModels(racing, {
        entry: 'openrouter',
        add: ['model-c'],
        remove: [],
        force: 'beta access',
      }),
    ).toBe(0)
    const saved = await readEntry(f.filePath)
    expect(saved.models).toEqual(['model-a', 'model-b', 'model-c'])
  })

  it('refuses a blank model name and writes nothing', async () => {
    const f = deps()
    await writeInitial(f.filePath, fileWith(['model-a']))
    expect(
      await providersModels(f.deps, { entry: 'openrouter', add: ['a b'], remove: [], force: 'x' }),
    ).toBe(1)
    const kept = await readEntry(f.filePath)
    expect(kept.models).toEqual(['model-a'])
  })

  it('removes a model, drops its forced reason, and clears a default naming it', async () => {
    const f = deps()
    const initial: ProvidersFile = {
      ...fileWith(['model-a', 'model-c']),
      defaultModel: 'openrouter/model-c',
      providers: [
        {
          ...entry(['model-a', 'model-c']),
          forcedModels: { 'model-c': 'beta access' },
        },
      ],
    }
    await writeInitial(f.filePath, initial)
    expect(await runModels(f, [], ['model-c'])).toBe(0)
    const saved = await readEntry(f.filePath)
    expect(saved.models).toEqual(['model-a'])
    expect(saved.forcedModels ?? {}).toEqual({})
    const read = await readProvidersFile(f.filePath)
    if (!read.ok) throw new Error(read.detail)
    expect(read.file.defaultModel).toBeUndefined()
  })

  it('refuses a removal the entry does not offer with the closest ids', async () => {
    const f = deps()
    await writeInitial(f.filePath, fileWith(['model-a']))
    expect(await runModels(f, [], ['model-z'])).toBe(1)
    expect(f.errors.join('\n')).toContain('model-a')
    const afterBadRemove = await readEntry(f.filePath)
    expect(afterBadRemove.models).toEqual(['model-a'])
  })
})
