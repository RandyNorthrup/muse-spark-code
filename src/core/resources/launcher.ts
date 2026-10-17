import type {
  ResourceLaunchProfile,
  ResourceProcessOptions,
  ResourceInteractiveProcess,
  ResourcePipedProcess,
} from './launch'
import type {
  execResourceFile as ResourceCommandRunner,
  handoffResourceFile as ResourceHandoffRunner,
} from './commands'

// The lazy launch shims, apart from admission's state (admission.ts): the
// launcher's own modules import that state, so the module that loads them
// must not be the one they import. Both ship together in
// dist/resourceAdmission.js (admissionEntry.ts).

/**
 * Portable process launch lives in its own first-use bundle
 * (dist/resourceProcess.js, POSTSPAWN), beside the governor's.
 * Hand-offs go through handoffResourceFile, the one hand-off entry point.
 */
export async function spawnResourceProcess(
  profile: 'interactive',
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
): Promise<ResourceInteractiveProcess>
export async function spawnResourceProcess(
  profile: 'contained' | 'probe' | 'bootstrap',
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
  extraDescriptors?: readonly number[],
): Promise<ResourcePipedProcess>
export async function spawnResourceProcess(
  profile: Exclude<ResourceLaunchProfile, 'handoff'>,
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
  extraDescriptors: readonly number[] = [],
): Promise<ResourceInteractiveProcess | ResourcePipedProcess> {
  const bundle = await import('./resourceProcessEntry.js')
  return profile === 'interactive'
    ? await bundle.spawnResourceProcess(profile, file, args, options)
    : await bundle.spawnResourceProcess(profile, file, args, options, extraDescriptors)
}

/** Bounded OS hand-off (opener, clipboard) through the same lazy boundary. */
export async function handoffResourceFile(
  ...args: Parameters<typeof ResourceHandoffRunner>
): Promise<void> {
  const bundle = await import('./resourceProcessEntry.js')
  await bundle.handoffResourceFile(...args)
}

/** Bounded helper commands share the same lazy process boundary. */
export async function execResourceFile(
  ...args: Parameters<typeof ResourceCommandRunner>
): Promise<Awaited<ReturnType<typeof ResourceCommandRunner>>> {
  const bundle = await import('./resourceProcessEntry.js')
  return await bundle.execResourceFile(...args)
}
