// Loading a bundle of our own that ships beside dist/extension.js but is
// not part of activation (PLAN.md D6): the Model API backend (M57) and the
// plan reader (M79). Node's own `require`, from wherever this code was
// bundled.

import { createRequire } from 'node:module'

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
