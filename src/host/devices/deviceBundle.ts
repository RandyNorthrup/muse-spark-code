// Editor-neutral loader: an unused port performs no module, storage or network work.
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { DeviceServiceDeps, createDeviceService } from './deviceEntry'
import type * as DeviceEntry from './deviceEntry'

interface DeviceBundle {
  readonly createDeviceService: typeof createDeviceService
  readonly DeviceStore: typeof DeviceEntry.DeviceStore
  readonly DeviceSecrets: typeof DeviceEntry.DeviceSecrets
  readonly AttemptJournal: typeof DeviceEntry.AttemptJournal
  readonly DeviceDiscovery: typeof DeviceEntry.DeviceDiscovery
  readonly startWindowsStorageProtection: typeof DeviceEntry.startWindowsStorageProtection
}
function isDeviceBundle(value: unknown): value is DeviceBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createDeviceService' in value &&
    typeof value.createDeviceService === 'function' &&
    'startWindowsStorageProtection' in value &&
    typeof value.startWindowsStorageProtection === 'function' &&
    'DeviceStore' in value &&
    typeof value.DeviceStore === 'function' &&
    'DeviceSecrets' in value &&
    typeof value.DeviceSecrets === 'function' &&
    'AttemptJournal' in value &&
    typeof value.AttemptJournal === 'function' &&
    'DeviceDiscovery' in value &&
    typeof value.DeviceDiscovery === 'function'
  )
}

/**
 * The storage binding a `dependencies` callback hands to both
 * `bundle.DeviceStore` and `bundle.AttemptJournal`. Windows requires the
 * native binding (its shipped C# is compiled into `helperDirectory`); other
 * platforms use POSIX owner/mode checks and directory fsync.
 */
export async function deviceStorageProtection(
  bundle: Pick<DeviceBundle, 'startWindowsStorageProtection'>,
  options: {
    readonly helperDirectory: string
    readonly systemRoot: string | undefined
    /** The extension or package folder that ships native/windows/. */
    readonly extensionPath: string
  },
  platform: NodeJS.Platform = process.platform,
): Promise<DeviceEntry.DeviceStorageProtection | undefined> {
  if (platform !== 'win32') return undefined
  if (options.systemRoot === undefined) throw new Error('storage')
  const binding = await bundle.startWindowsStorageProtection({
    directory: options.helperDirectory,
    systemRoot: options.systemRoot,
    extensionPath: options.extensionPath,
  })
  return binding.protection
}

/** VS Code, companion editors and runtime callers use the same explicit method port. */
export function deviceMethods(options: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
  readonly dependencies: (bundle: DeviceBundle) => Promise<DeviceServiceDeps>
}) {
  const load = lazyBundleLoader({
    ...options,
    isBundle: isDeviceBundle,
    label: 'Devices bundle',
    unavailable: () => UI_TEXT.devices.bundleUnavailable,
  })
  let pending: Promise<Awaited<ReturnType<typeof createDeviceService>>> | undefined
  let current: Awaited<ReturnType<typeof createDeviceService>> | undefined
  const lifetime = { isDisposed: false }
  const isDisposed = () => lifetime.isDisposed
  async function service() {
    if (isDisposed()) throw new Error('revoked')
    pending ??= (async () => {
      const bundle = load()
      const deps = await options.dependencies(bundle)
      if (isDisposed()) throw new Error('revoked')
      const instance = await bundle.createDeviceService(deps, UI_TEXT, uiLocale())
      if (isDisposed()) {
        instance.dispose()
        throw new Error('revoked')
      }
      current = instance
      return instance
    })()
    try {
      return await pending
    } catch (error) {
      pending = undefined
      throw error
    }
  }
  return {
    service,
    dispose(): void {
      lifetime.isDisposed = true
      current?.dispose()
    },
  }
}
