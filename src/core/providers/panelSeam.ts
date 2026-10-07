function unavailable(): never {
  throw new Error(UI_TEXT.modelsPanelUnavailable)
}
// Compose the panel's existing ports with the nonsecret providers file.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { ModelsPanelSeam, ProviderEntry, PresetInfo } from '../../host/providers/providerPorts'
import { emptyProvidersFile, readProvidersFile, writeProvidersFileAtomic } from './providersFile'
import { listedPresets, PRESETS, PLAN_KEY_PRESETS, isKeyShape } from './presets'
import { checkEndpointUrl } from './endpointPolicy'
import { createPkcePair } from './pkce'
import { UI_TEXT } from '../../shared/constants'

export function createModelsPanelSeam(options: {
  readonly configFile: string
  readonly subscriptionModels: (id: string) => Promise<readonly string[]>
  readonly resolve?: (host: string) => Promise<readonly string[]>
}): ModelsPanelSeam {
  const read = async () => {
    const result = await readProvidersFile(options.configFile)
    if (!result.ok) {
      if (result.reason === 'missing') return emptyProvidersFile()
      throw new Error(UI_TEXT.actionFailed)
    }
    return result.file
  }
  let writes = Promise.resolve()
  const mutate = <T>(work: (file: Awaited<ReturnType<typeof read>>) => Promise<T>) => {
    const previous = writes
    const next = (async () => {
      await previous
      return await work(await read())
    })()
    writes = (async () => {
      try {
        await next
      } catch {
        /* A failed transaction must not block the next writer. */
      }
    })()
    return next
  }
  const save = async (file: unknown) => {
    const result = await writeProvidersFileAtomic(options.configFile, file)
    if (!result.ok) throw new Error(UI_TEXT.actionFailed)
  }
  const entry = (row: Awaited<ReturnType<typeof read>>['providers'][number]): ProviderEntry => {
    if (row.address === undefined) throw new Error(UI_TEXT.actionFailed)
    return { ...row, address: row.address }
  }
  const store: ModelsPanelSeam['store'] = {
    list: async () => {
      const file = await read()
      return file.providers.map((row) => entry(row))
    },
    defaultModel: async () => {
      const file = await read()
      return file.defaultModel
    },
    setDefaultModel: (ref) =>
      mutate(async (file) => {
        const { defaultModel: _old, ...rest } = file
        await save({ ...rest, ...(ref !== undefined && { defaultModel: ref }) })
      }),
    add: (row) =>
      mutate(async (file) => {
        if (file.providers.some((old) => old.id === row.id)) throw new Error(UI_TEXT.actionFailed)
        await save({ ...file, providers: [...file.providers, row] })
      }),
    remove: (id) =>
      mutate(async (file) => {
        const found = file.providers.find((row) => row.id === id)
        const { defaultModel, ...rest } = file
        await save({
          ...rest,
          ...(defaultModel !== undefined && !defaultModel.startsWith(`${id}/`) && { defaultModel }),
          providers: file.providers.filter((row) => row.id !== id),
        })
        return found === undefined ? undefined : entry(found)
      }),
    restore: (row) =>
      mutate(async (file) => {
        await save({
          ...file,
          providers: [...file.providers.filter((old) => old.id !== row.id), row],
        })
      }),
    replaceAll: (rows, replacement) =>
      mutate(async (file) => {
        const { defaultModel, ...rest } = file
        const nextDefault = replacement === undefined ? defaultModel : replacement.defaultModel
        await save({
          ...rest,
          providers: rows,
          ...(nextDefault !== undefined && { defaultModel: nextDefault }),
        })
        return file.providers.map((row) => entry(row))
      }),
  }
  const catalog = new Map<string, PresetInfo>()
  for (const preset of [
    ...listedPresets(),
    ...PRESETS.filter((row) => row.category === 'local'),
    ...PLAN_KEY_PRESETS,
  ]) {
    const origin = preset.origin.kind === 'fixed' ? preset.origin.origin : ''
    let kind: PresetInfo['kind'] = preset.category === 'custom' ? 'cloud' : preset.category
    if (PLAN_KEY_PRESETS.some((plan) => plan.id === preset.id)) kind = 'subscription'
    catalog.set(preset.id, {
      id: preset.id,
      name: preset.label,
      description: preset.description,
      kind,
      origin,
      format: preset.format,
      auth: preset.auth,
      keyHint: preset.keyHint,
      keyPage: preset.keyPage ?? '',
      isKeyShape: (value) => isKeyShape(preset.keyShape, value),
      freeTest: preset.keyTest.kind === 'models-list' ? 'modelsList' : 'none',
      localProbes:
        preset.origin.kind === 'loopback'
          ? [{ host: '127.0.0.1', port: preset.origin.defaultPort, path: preset.modelsList.path }]
          : [],
    })
  }
  for (const [id, address, format] of [
    ['chatgpt', 'https://api.openai.com', 'responses'],
    ['copilot', 'https://github.com/copilot', 'chat'],
  ]) {
    if (id === undefined || address === undefined || format === undefined) continue
    catalog.set(id, {
      id,
      name: id === 'chatgpt' ? 'ChatGPT' : 'Copilot',
      description: id === 'chatgpt' ? UI_TEXT.acpChatGpt.notice : UI_TEXT.planUi.aiContent,
      kind: 'cloud',
      origin: address,
      format,
      auth: 'subscription',
      keyHint: '',
      keyPage: '',
      isKeyShape: () => false,
      freeTest: 'none',
      localProbes: [],
    })
  }
  return {
    store,
    catalog: {
      get: (id) => catalog.get(id),
      has: (id) => catalog.has(id),
      ids: () => {
        const ids: string[] = []
        catalog.forEach((_preset, id) => {
          ids.push(id)
        })
        return ids
      },
    },
    policy: {
      check: async (address) => {
        const initial = checkEndpointUrl(address, [])
        if (initial.kind === 'refused' && initial.reason !== 'unresolved-address')
          return { kind: 'refused', detail: initial.reason }
        const host = new URL(address).hostname.replaceAll(/^\[|\]$/g, '')
        let answers: readonly string[] = [host]
        try {
          if (isIP(host) === 0) {
            if (options.resolve === undefined) {
              const records = await lookup(host, { all: true })
              answers = records.map(({ address }) => address)
            } else {
              answers = await options.resolve(host)
            }
          }
        } catch {
          return { kind: 'refused', detail: 'unresolved-address' }
        }
        const verdict = checkEndpointUrl(address, answers)
        if (verdict.kind === 'ok') return { kind: 'ok' }
        return verdict.kind === 'confirm-private'
          ? { kind: 'private', address }
          : { kind: 'refused', detail: verdict.reason }
      },
    },
    // The host composes key tests and scans from the shared pinned transport.
    tester: { test: unavailable },
    exchanger: undefined,
    usage: undefined,
    fetcher: {
      fetchModels: async (provider) => {
        if (provider.auth !== 'subscription') return unavailable()
        const models = await options.subscriptionModels(provider.id)
        return {
          rows: models.map((id) => ({
            id,
            label: id,
            toolCapable: true,
            vision: false,
            reasoning: provider.id === 'chatgpt',
            context: undefined,
            priceFingerprint: 'plan',
            isFree: false,
            isLocal: false,
          })),
        }
      },
    },
    pkce: { create: createPkcePair, newState: () => createPkcePair().state },
    suggest: {
      defaultModel: (rows) =>
        rows[0] === undefined
          ? undefined
          : { value: rows[0].id, reason: UI_TEXT.suggestDefaultModel },
      sessionBudget: () => {
        return /* Plan inference has no USD budget suggestion. */
      },
    },
  }
}
