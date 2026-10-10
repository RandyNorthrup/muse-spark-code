// M97 CM971-R3: build-captured source hashes, typed for the unit tests.
import type { Plugin } from 'esbuild'

export function readCompiledSource(file: string): string
export const compiledSourceRecorder: Plugin
export function compiledInputHashes(inputs: readonly string[]): Record<string, string>
