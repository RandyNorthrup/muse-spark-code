import path from 'node:path'
import { requireFile } from '../host/lazyBundle'
import { RUNTIME_MAKER_BUNDLE_FILE, UI_TEXT } from '../shared/constants'
import type { runRuntimeMaker, runtimeMakerAcp } from './maker/entry'

interface RuntimeMakerBundle {
  readonly runRuntimeMaker: typeof runRuntimeMaker
  readonly runtimeMakerAcp: typeof runtimeMakerAcp
}
// Same-source, same-build entry signature, like the existing Node lazy factories (§8).
function isRuntimeMakerBundle(raw: unknown): raw is RuntimeMakerBundle {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'runRuntimeMaker' in raw &&
    typeof raw.runRuntimeMaker === 'function' &&
    'runtimeMakerAcp' in raw &&
    typeof raw.runtimeMakerAcp === 'function'
  )
}
export function runtimeMakerBundle(distDirectory: string): RuntimeMakerBundle {
  const loaded = requireFile(path.join(distDirectory, RUNTIME_MAKER_BUNDLE_FILE))
  if (!isRuntimeMakerBundle(loaded)) throw new Error(UI_TEXT.makerUnattendedDenied)
  return loaded
}
