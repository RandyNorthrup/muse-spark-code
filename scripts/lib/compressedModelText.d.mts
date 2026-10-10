// The production encoder also runs in typed private bundle fixtures.
import type { Plugin } from 'esbuild'

export function compressedModelText(isProduction: boolean): Plugin
