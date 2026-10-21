// M97 CM971-R3: build-captured source hashes, typed for the unit tests.
import type { BuildOptions } from 'esbuild'

export interface BuildRecord {
  readonly inputs: Map<string, string | null>
  readonly generated: Map<string, string>
}

export function readCompiledSource(file: string): string
export function newBuildRecord(): BuildRecord
export function withCompiledRecording<T extends BuildOptions>(
  options: T,
  buildRecord: BuildRecord,
): T
export function compiledRecordFor(
  metafileInputs: readonly string[],
  buildRecord: BuildRecord,
): { readonly inputs: Record<string, string>; readonly generated: Record<string, string> }
