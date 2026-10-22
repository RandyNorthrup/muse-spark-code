import type { Metafile } from 'esbuild'
export function buildNodeWorkspace(output?: string, dependencyRoot?: string): Promise<Metafile>
