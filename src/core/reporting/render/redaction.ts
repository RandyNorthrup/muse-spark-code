import { createExportTextScrubber } from '../../export/sessionTransfer'
import type { SourceSnapshot } from '../sources/types'

export interface ReportRedaction {
  readonly workspaceRoot?: string
  readonly homeRoot?: string
  readonly localRoots?: readonly string[]
}

/** Workspace paths become portable; the export scrub removes outside paths. */
export function reportScrubber(options: ReportRedaction = {}): (text: string) => string {
  const scrub = createExportTextScrubber({
    redact: true,
    localRoots: [
      ...(options.localRoots ?? []),
      ...(options.homeRoot === undefined ? [] : [options.homeRoot]),
    ],
  })
  const roots = [{ root: options.workspaceRoot, replacement: './' }]
    .flatMap(({ root, replacement }) => {
      if (root === undefined) return []
      const normalized = root.replaceAll(/[\\/]+/g, '/').replace(/\/+$/, '')
      // Bare roots would match ordinary text. Unknown paths still pass the export scrub.
      if (normalized.split('/').filter(Boolean).length < 2) return []
      const escaped = normalized
        .split('/')
        .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
        .join(String.raw`[\\/]+`)
      return [
        {
          // Root segments are escaped above; only fixed separator/boundary/tail syntax remains.
          // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
          pattern: new RegExp(
            // Spaces belong to the path; quotes, controls and invalid path characters end it.
            String.raw`(?<![\w./:])${escaped}(?=[\\/]|[\s"'<>]|$)(?:[\\/]+[^"'<>|?*:\p{Cc}]*)?`,
            /^[A-Za-z]:/.test(normalized) ? 'giu' : 'gu',
          ),
          replacement,
          rootLength: normalized.length,
        },
      ]
    })
    .toSorted((a, b) => b.pattern.source.length - a.pattern.source.length)
  return (text) => {
    let clean = text
    for (const { pattern, replacement, rootLength } of roots) {
      clean = clean.replaceAll(
        pattern,
        (match) =>
          `${replacement}${match
            .replaceAll(/[\\/]+/g, '/')
            .slice(rootLength)
            .replace(/^\/+/, '')}`,
      )
    }
    return scrub(clean)
  }
}

/** Walk decoded strings and object keys in an already-cloned value tree. */
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
