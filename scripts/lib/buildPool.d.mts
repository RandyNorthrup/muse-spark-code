// Types for scripts/lib/buildPool.mjs, which the production build and its
// unit test import.
export type PoolStart<T> = () => Promise<T>
export type PoolSpec<T> = readonly [name: string, start: PoolStart<T>]
export declare function runBuildPool<T>(
  specs: readonly PoolSpec<T>[],
  size: number,
): Promise<Record<string, T>>
