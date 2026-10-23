// Types for scripts/lib/lazyRegistry.mjs: the generated lazy-bundle
// registry's scanner.
export interface LazyRequest {
  /** Root-relative source with forward slashes. */
  readonly importer: string
  /** 1-based line of the naming literal. */
  readonly line: number
  /** The dist name as spelled (dist/, relative or bare). */
  readonly value: string
  /** The function, method or constant the name stands in. */
  readonly symbol: string
  /** The const holding it, when assigned. */
  readonly identifier?: string
}
/** A load whose file name is not a literal. */
export interface ComputedLoad {
  /** Root-relative source with forward slashes. */
  readonly importer: string
  /** 1-based line of the load. */
  readonly line: number
  /** The callee and its first argument, without white space. */
  readonly call: string
}
/** A computed load the registry accepts, with the reason it still knows the file. */
export interface ListedComputedLoad {
  readonly importer: string
  readonly call: string
  readonly reason: string
}
export interface LazyScan {
  readonly requests: readonly LazyRequest[]
  /** Bundle-name constant to defining file. */
  readonly definitions: ReadonlyMap<string, string>
  /** Constant to every other mentioning file. */
  readonly uses: ReadonlyMap<string, readonly string[]>
  /** Constant to files loading by it, the defining file included. */
  readonly usesLoad: ReadonlyMap<string, readonly string[]>
  /** Loads whose file name is worked out at run time. */
  readonly computed: readonly ComputedLoad[]
}
export interface LazyResolution {
  readonly mapped?: string
  readonly file?: string
  readonly bundled?: true
}
export const COMPUTED_SOURCE_LOADS: readonly ListedComputedLoad[]
export function codeLines(text: string): string[]
/** Whether the text reads the name whole: no identifier character beside it. */
export function hasIdentifier(text: string, identifier: string): boolean
export function scanRequests(root: string, generatedFile: string): LazyScan
/** One sentence per computed load that is not listed, or listed and gone. */
export function computedLoadFailures(
  computed: readonly ComputedLoad[],
  listed?: readonly ListedComputedLoad[],
): string[]
export function resolveRequest(
  root: string,
  deferredOutfiles: ReadonlyMap<string, string>,
  request: LazyRequest,
): LazyResolution
export function forwardSlashes(file: string): string
/** Files the production build writes below dist/ without esbuild. */
export const NON_ESBUILD_OUTPUTS: readonly string[]
export function isStableBundle(file: string): boolean
/**
Every dist bundle the metafiles in `directory` emit: outputs below dist/
ending in .js whose file is on disk. Stale records never become rows.
*/
export function readMetafiles(
  directory: string,
  root: string,
  emitted: Set<string>,
  inputChunks: Map<string, Set<string>>,
  importEdges: Map<string, Set<string>>,
): void
/** The stable emitted outputs plus the files the build writes without esbuild. */
export function knownBundleOutputs(emitted: ReadonlySet<string>): Set<string>
