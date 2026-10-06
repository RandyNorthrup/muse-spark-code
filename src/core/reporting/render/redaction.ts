import { createExportTextScrubber } from '../../export/sessionTransfer'
import type { SourceSnapshot } from '../sources/types'

export interface ReportRedaction {
  readonly workspaceRoot?: string
  readonly homeRoot?: string
  readonly localRoots?: readonly string[]
}

/** Known roots become portable paths; the export scrub removes unknown roots. */
export function reportScrubber(options: ReportRedaction = {}): (text: string) => string {
  const scrub = createExportTextScrubber({ redact: true, localRoots: options.localRoots ?? [] })
  const roots = [
    { root: options.workspaceRoot, replacement: './' },
    { root: options.homeRoot, replacement: '~/' },
  ]
    .flatMap(({ root, replacement }) => {
      if (root === undefined) return []
      const normalized = root.replaceAll('\\', '/').replace(/\/+$/, '')
      // Bare roots would match ordinary text. Unknown paths still pass the export scrub.
      if (normalized.split('/').filter(Boolean).length < 2) return []
      const escaped = normalized
        .split('/')
        .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
        .join(String.raw`[\\/]+`)
      return [
        {
          pattern: new RegExp(
            String.raw`(?<![\w./:])${escaped}(?=[\\/]|[\s"'<>]|$)[\\/]*`,
            /^[A-Za-z]:/.test(normalized) ? 'gi' : 'g',
          ),
          replacement,
        },
      ]
    })
    .toSorted((a, b) => b.pattern.source.length - a.pattern.source.length)
  return (text) => {
    let clean = text
    for (const { pattern, replacement } of roots) {
      clean = clean.replaceAll(pattern, () => replacement)
    }
    return scrub(clean)
  }
}

/** Clone preserves the normalized contract; every string value is scrubbed in place. */
export function scrubFields(value: unknown, scrub: (text: string) => string): void {
  if (typeof value !== 'object' || value === null) return
  for (const key of Object.keys(value)) {
    const field: unknown = Reflect.get(value, key)
    if (typeof field === 'string') Reflect.set(value, key, scrub(field))
    else scrubFields(field, scrub)
    const cleanKey = scrub(key)
    if (cleanKey === key) continue
    if (Object.hasOwn(value, cleanKey))
      throw new Error('Report source keys collide after scrubbing')
    const cleanField: unknown = Reflect.get(value, key)
    Reflect.deleteProperty(value, key)
    Reflect.defineProperty(value, cleanKey, {
      value: cleanField,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
}

/** S/N call this once after assembling their normalized facts and before K collects. */
export function scrubSourceSnapshot(
  snapshot: SourceSnapshot,
  options: ReportRedaction = {},
): SourceSnapshot {
  const clean = structuredClone(snapshot)
  scrubFields(clean, reportScrubber(options))
  return clean
}
