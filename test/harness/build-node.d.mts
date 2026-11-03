import type { Metafile } from 'esbuild'
export const NODE_WORKSPACE_KEY: string
export function buildNodeWorkspace(output?: string, dependencyRoot?: string): Promise<Metafile>
