// The editor-chat suites' shared rig: the real providers file (local,
// unpriced, priced and reasoning-switchable entries) plus an empty
// catalogue, and the real configured services over them. Resolve never
// leaves the machine; the injected socket fails the suite if a request
// is ever sent. Both the unit suite and the integration suite resolve
// their models from here, so the two prove the same registry.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createConfiguredProviderServices } from '../../../src/core/providers/configured'
import { PROVIDERS_FILE_VERSION } from '../../../src/shared/constants'

function toolsOnly(model: string) {
  return { [model]: { tools: { calling: { state: 'yes', value: true } } } }
}

export function writeEditorChatProvidersFile(directory: string): {
  configFile: string
  catalogFile: string
} {
  const configFile = path.join(directory, 'providers.json')
  const catalogFile = path.join(directory, 'catalog.json')
  writeFileSync(
    configFile,
    JSON.stringify({
      v: PROVIDERS_FILE_VERSION,
      providers: [
        {
          id: 'probe-custom',
          preset: 'custom',
          address: 'https://8.8.8.8/v1',
          auth: 'none',
          format: 'responses',
          models: ['custom-model'],
          modelLimits: { 'custom-model': { contextTokens: 4096, outputTokens: 512 } },
          modelCapabilities: toolsOnly('custom-model'),
        },
        {
          id: 'probe-keyed',
          preset: 'custom',
          address: 'https://8.8.4.4/v1',
          auth: 'apiKey',
          format: 'responses',
          models: ['keyed-model'],
          modelLimits: { 'keyed-model': { contextTokens: 4096, outputTokens: 512 } },
          modelCapabilities: toolsOnly('keyed-model'),
        },
        {
          id: 'probe-priced',
          preset: 'custom',
          address: 'https://8.8.4.4/v1',
          auth: 'apiKey',
          format: 'responses',
          models: ['priced-model'],
          modelLimits: { 'priced-model': { contextTokens: 16_384, outputTokens: 2048 } },
          modelCapabilities: {
            'priced-model': {
              tools: { calling: { state: 'yes', value: true } },
              reasoning: {
                supported: { state: 'yes', value: true },
                effortLevels: { state: 'yes', value: ['low', 'medium', 'high'] },
                canDisable: { state: 'no' },
              },
              modalities: { image: { state: 'yes', value: { mimes: ['image/png'] } } },
            },
          },
          prices: {
            'priced-model': { input: 0.000001, output: 0.000004, request: 0.01, image: 0.05 },
          },
        },
        {
          id: 'probe-offable',
          preset: 'custom',
          address: 'https://8.8.4.4/v1',
          auth: 'none',
          format: 'responses',
          models: ['offable-model'],
          modelLimits: { 'offable-model': { contextTokens: 8192, outputTokens: 1024 } },
          modelCapabilities: {
            'offable-model': {
              tools: { calling: { state: 'yes', value: true } },
              reasoning: {
                supported: { state: 'yes', value: true },
                effortLevels: { state: 'yes', value: ['none', 'low'] },
                canDisable: { state: 'yes', value: true },
              },
            },
          },
        },
      ],
    }),
  )
  writeFileSync(catalogFile, JSON.stringify({ providers: {} }))
  return { configFile, catalogFile }
}

export function createEditorChatServices(configFile: string, catalogFile: string) {
  return createConfiguredProviderServices(undefined, {
    configFile,
    catalogFile,
    secrets: { get: () => Promise.resolve(undefined) },
    send: () => Promise.reject(new Error('no request may leave the machine')),
  })
}
