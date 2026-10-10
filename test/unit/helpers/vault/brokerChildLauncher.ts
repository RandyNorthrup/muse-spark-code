// The crash fixture exercises kernel locks, not governor admission (covered by spawn suites).
import { type SpawnOptions } from 'node:child_process'
import { fixtureResourceProcess } from '../resourceProcess'
export { fixtureResourceCommand as execResourceFile } from '../resourceProcess'
export function spawnResourceProcess(
  profile: 'contained',
  file: string,
  args: readonly string[],
  options: SpawnOptions,
  extra: readonly number[] = [],
) {
  return fixtureResourceProcess(profile, file, args, options, ['pipe', 'pipe', 'pipe', ...extra])
}
