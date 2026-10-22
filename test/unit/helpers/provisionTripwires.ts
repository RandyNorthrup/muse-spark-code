// Tripwire ports for the provisioning suites: every provider and node
// method fails loudly on contact. A test that reaches a port it must not
// touch fails instead of proving a double — no provider exists until the
// M109 broker and M110d/M110f bindings land.
import type { EstimateNodePort, EstimateProviderPort } from '../../../src/shared/estimate'

export function unreachablePort(what: string): Error {
  return new Error(`under test without a provider: ${what} must never be contacted`)
}

export function tripwireProvider(): EstimateProviderPort {
  return {
    id: 'tripwire',
    apiOrigin: 'https://provider.invalid',
    endpoints: [],
    sizes: () => {
      throw unreachablePort('sizes')
    },
    images: () => {
      throw unreachablePort('images')
    },
    create: () => {
      throw unreachablePort('create')
    },
    status: () => {
      throw unreachablePort('status')
    },
    delete: () => {
      throw unreachablePort('delete')
    },
  }
}

export function tripwireNode(): EstimateNodePort {
  return {
    install: () => {
      throw unreachablePort('install')
    },
    pair: () => {
      throw unreachablePort('pair')
    },
    teardownAndWipe: () => {
      throw unreachablePort('teardownAndWipe')
    },
  }
}
