// Which backend a window uses, and what the sign-in gate offers (PLAN.md D1,
// M7). The two credentials pay from different places, so they are never
// mixed: the Muse Code CLI runs on its own sign-in (the owner's subscription,
// or a key the CLI itself holds), and a Model API key pasted into the panel
// drives only the Model API backend. The extension never hands the pasted
// key to the CLI (it did until M7, and the CLI prefers `META_API_KEY` over
// its browser session, which billed the subscription's work to the key).

import type { BackendMode } from '../shared/constants'
import type { SignInMethod } from '../shared/protocol'
import type { BackendKind } from './agent/agentBackend'

export interface BackendFacts {
  /** `museSpark.backend`. */
  readonly setting: BackendMode
  readonly hasCli: boolean
  /** The CLI's own credential: its file, or `META_API_KEY` in the environment. */
  readonly hasCliSession: boolean
  /** A Model API key in the extension's secret storage. */
  readonly hasStoredKey: boolean
}

export type BackendChoice =
  | {
      readonly kind: BackendKind
      readonly status: 'signedIn' | 'signedOut'
      /** The sign-in paths the gate offers while signed out. */
      readonly methods: readonly SignInMethod[]
    }
  | {
      readonly kind: undefined
      readonly status: 'noCli'
      readonly methods: readonly SignInMethod[]
    }

const BOTH: readonly SignInMethod[] = ['browser', 'apiKey']
const BROWSER_ONLY: readonly SignInMethod[] = ['browser']
const KEY_ONLY: readonly SignInMethod[] = ['apiKey']

export function selectBackend(facts: BackendFacts): BackendChoice {
  switch (facts.setting) {
    case 'museCode': {
      if (!facts.hasCli) {
        return { kind: undefined, status: 'noCli', methods: [] }
      }
      return {
        kind: 'museCode',
        status: facts.hasCliSession ? 'signedIn' : 'signedOut',
        methods: BROWSER_ONLY,
      }
    }
    case 'modelApi': {
      return {
        kind: 'modelApi',
        status: facts.hasStoredKey ? 'signedIn' : 'signedOut',
        methods: KEY_ONLY,
      }
    }
    case 'auto': {
      if (facts.hasCli && facts.hasCliSession) {
        return { kind: 'museCode', status: 'signedIn', methods: BOTH }
      }
      if (facts.hasStoredKey) {
        return { kind: 'modelApi', status: 'signedIn', methods: BOTH }
      }
      return facts.hasCli
        ? { kind: 'museCode', status: 'signedOut', methods: BOTH }
        : { kind: undefined, status: 'noCli', methods: KEY_ONLY }
    }
  }
}
