// The sign-in gate's bundle (dist/auth.js, PLAN.md D6): AuthService and the
// three-valued credential read. Activation keeps only the loader; the bundle
// is required the first time a credential, money or consent path needs it.
import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { createAuthService, hasStoredKey } from './authEntry'

export interface AuthBundle {
  readonly createAuthService: typeof createAuthService
  readonly hasStoredKey: typeof hasStoredKey
}
export function isAuthBundle(value: unknown): value is AuthBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createAuthService' in value &&
    typeof value.createAuthService === 'function' &&
    'hasStoredKey' in value &&
    typeof value.hasStoredKey === 'function'
  )
}
export function authBundleLoader(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: (file: string) => unknown
}): () => AuthBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isAuthBundle,
    label: 'sign-in gate',
    unavailable: () => UI_TEXT.actionFailed,
  })
}
