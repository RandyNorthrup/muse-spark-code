// Loading a bundle of our own that ships beside dist/extension.js but is
// not part of activation (PLAN.md D6): the Model API backend (M57) and the
// plan reader (M79). Node's own `require`, from wherever this code was
// bundled.

import { createRequire } from 'node:module'
import type { Logger } from './logger'

/** Node's own `require` of an absolute path. */
export function requireFile(file: string): unknown {
  return createRequire(file)(file)
}

/**
 * Forgets a file Node loaded but that is not the bundle, so the next load
 * reads it again: a module that ran without throwing stays in Node's cache,
 * and a file repaired in place would otherwise never be seen (the review of
 * PR #47). One that threw while loading is never cached.
 */
export function forgetFile(file: string): void {
  const nodeRequire = createRequire(file)
  Reflect.deleteProperty(nodeRequire.cache, nodeRequire.resolve(file))
}

export interface LazyBundleLoaderOptions<T> {
  /** The bundle beside the running one (`dist/<name>.js`). */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
  /**
   * Whether a required module is the bundle. Signatures are taken on trust
   * (PLAN.md §8): entry, loader and package come from one source tree, one
   * `npm run build` and one package.
   */
  readonly isBundle: (value: unknown) => value is T
  /** What the bundle is, for the log. */
  readonly label: string
  /** The words the user reads when it cannot be loaded, read when it fails (the log has the cause). */
  readonly unavailable: () => string
}

/**
 * The bundle, required the first time it is asked for and kept from then on.
 * A missing or corrupt bundle throws `unavailable` and is tried again on the
 * next call.
 */
export function lazyBundleLoader<T>(options: LazyBundleLoaderOptions<T>): () => T {
  const { bundlePath, log, loadBundle = requireFile, isBundle, label, unavailable } = options
  let bundle: T | undefined
  return () => {
    if (bundle !== undefined) {
      return bundle
    }
    let loaded: unknown
    try {
      loaded = loadBundle(bundlePath)
    } catch (error: unknown) {
      log.error(
        `The ${label} ${bundlePath} could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw new Error(unavailable(), { cause: error })
    }
    if (!isBundle(loaded)) {
      log.error(`${bundlePath} does not export the ${label}`)
      if (options.loadBundle === undefined) {
        forgetFile(bundlePath)
      }
      throw new Error(unavailable())
    }
    bundle = loaded
    return bundle
  }
}
