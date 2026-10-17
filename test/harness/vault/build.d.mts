import type { Metafile } from 'esbuild'
export function buildVaultSurfaces(
  outdir: string,
  hasHarness?: boolean,
): Promise<{ browser: Metafile | undefined; host: Metafile | undefined }>
