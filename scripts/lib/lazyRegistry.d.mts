// Types for scripts/lib/lazyRegistry.mjs: the generated lazy-bundle
// registry's scanner (MODELAPIDIETR4, review RVAPP-MODELAPIDIET3 P2-1/P2-2).
export interface LazyRequest {
  /** Root-relative source with forward slashes. */
  readonly importer: string
  /** 1-based line of the naming literal. */
  readonly line: number
  /** The dist name as spelled (dist/, relative or bare). */
  readonly value: string
  /** The const holding it, when assigned. */
  readonly identifier?: string
}
export interface LazyScan {
  readonly requests: readonly LazyRequest[]
  /** Bundle-name constant to defining file. */
  readonly definitions: ReadonlyMap<string, string>
  /** Constant to every mentioning file. */
  readonly uses: ReadonlyMap<string, readonly string[]>
  /** Constant to files loading by it. */
  readonly usesLoad: ReadonlyMap<string, readonly string[]>
  /** Unresolvable computed bundle names. */
  readonly dynamics: readonly string[]
}
export interface LazyResolution {
  readonly mapped?: string
  readonly file?: string
  readonly bundled?: true
}
export function codeLines(text: string): string[]
/** Whether the text reads the name whole: no identifier character beside it. */
export function usesIdentifier(text: string, identifier: string): boolean
export function scanRequests(root: string, generatedFile: string): LazyScan
export function resolveRequest(
  root: string,
  deferredOutfiles: ReadonlyMap<string, string>,
  request: LazyRequest,
): LazyResolution
