// The node crash hook's loader (M111 lane OB): dist/nodeCrashHook.js at
// node CLI startup, with an honest degradation when the chunk is gone (a
// broken install still starts; only crash capture is lost, said once in
// fixed words).
import path from 'node:path'
import { requireFile } from '../../host/lazyBundle'
import { O11Y_CRASH_HOOK_BUNDLE_FILE, UI_TEXT } from '../../shared/constants'
import type { installNodeCrashHook } from './crashHook'

/**
The lazy chunk's shape.
*/
export interface NodeCrashHookBundle {
  readonly installNodeCrashHook: typeof installNodeCrashHook
}

/**
Same-build factory signatures are trusted after checking the exports (PLAN §8).
*/
export function isNodeCrashHookBundle(value: unknown): value is NodeCrashHookBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'installNodeCrashHook' in value &&
    typeof value.installNodeCrashHook === 'function'
  )
}

/**
Install the node crash hook from its lazy chunk. Returns the
uninstaller, or undefined with the fixed unavailable word when the chunk
is gone or malformed.
*/
export function installNodeCrashHookBundle(deps: {
  readonly distDir: string
  readonly root: string
  readonly report: (error: unknown) => void
  readonly loadBundle?: ((file: string) => unknown) | undefined
  readonly print?: ((line: string) => void) | undefined
}): (() => void) | undefined {
  const print =
    deps.print ??
    ((line: string): void => {
      process.stderr.write(`${line}\n`)
    })
  const load = deps.loadBundle ?? requireFile
  let module: unknown
  try {
    module = load(path.join(deps.distDir, O11Y_CRASH_HOOK_BUNDLE_FILE))
  } catch (error: unknown) {
    // A missing chunk degrades to no crash capture; anything else keeps its kind.
    const isMissing =
      error instanceof Error &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND' &&
      error.message.includes(O11Y_CRASH_HOOK_BUNDLE_FILE)
    if (!isMissing) throw error
    print(UI_TEXT.nodeErrors.unavailable)
    return undefined
  }
  if (!isNodeCrashHookBundle(module)) {
    print(UI_TEXT.nodeErrors.unavailable)
    return undefined
  }
  return module.installNodeCrashHook(deps.root, deps.report)
}
