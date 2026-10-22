// The OS binding Devices storage (pairing store and attempt journal) uses
// where POSIX owner/mode bits and directory fsync do not exist. Windows
// requires one (src/host/devices/windowsStorageProtection.ts); no fallback.

export interface DeviceStorageProtection {
  /** Owner-only access on this exact path. Checks only; never repairs. */
  assertPrivate(file: string, isDirectory: boolean): Promise<void>
  /**
  `directory` and every folder above it may be readable, but no other user
  may replace any of them or their entries on this path. One call covers the chain.
  */
  assertSafeAncestor(directory: string): Promise<void>
  /** Claims a path this process has just created exclusively, then checks it. */
  secureFresh(file: string, isDirectory: boolean): Promise<void>
  /** Atomically and durably replaces `target` with `stage`. */
  replace(stage: string, target: string): Promise<void>
  /** Makes completed entry changes in `directory` durable. */
  syncDirectory(directory: string): Promise<void>
}
