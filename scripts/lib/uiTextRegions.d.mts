// Build plugins shared by production output and typed private fixture builds.
import type { Plugin } from 'esbuild'

export const UI_TEXT_REGIONS: readonly {
  readonly name: string
  readonly output: string
  readonly keys: RegExp
}[]
export function regionalUiText(name?: string): Plugin
export function compressedEnglish(
  file: string,
  isProduction: boolean,
  compressionQuality: number,
): Plugin
