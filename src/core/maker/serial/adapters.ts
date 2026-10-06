import type { SerialCommand } from './process'

export interface SerialLineSettings {
  readonly baud: number
  readonly durationMs: number
  readonly maxBytes: number
  readonly chunkBytes: number
  readonly pollMs: number
  readonly dtr: boolean
  readonly rts: boolean
}

export type SerialAdapter =
  | { readonly kind: 'pio' | 'arduino-cli'; readonly file: string }
  | { readonly kind: 'windows'; readonly file: string }
  | { readonly kind: 'pyserial' | 'posix-raw'; readonly file: string; readonly script: string }
  | { readonly kind: 'stty'; readonly file: string; readonly shell: string }

export function serialAdapterCommand(
  adapter: SerialAdapter,
  port: string,
  settings: SerialLineSettings,
): SerialCommand {
  const baud = String(settings.baud)
  const args = [
    port,
    baud,
    String(settings.durationMs),
    String(settings.maxBytes),
    String(settings.chunkBytes),
    String(settings.pollMs),
    settings.dtr ? '1' : '0',
    settings.rts ? '1' : '0',
  ]
  switch (adapter.kind) {
    case 'pio': {
      return {
        file: adapter.file,
        args: [
          'device',
          'monitor',
          '--port',
          port,
          '--baud',
          baud,
          '--raw',
          '--quiet',
          '--dtr',
          settings.dtr ? '1' : '0',
          '--rts',
          settings.rts ? '1' : '0',
        ],
        writable: false,
      }
    }
    case 'arduino-cli': {
      throw new Error('serial-line-settings-unsupported')
    }
    case 'windows': {
      return {
        file: adapter.file,
        args: ['serial', ...args],
        readyWord: 'serial-ready',
        writable: true,
      }
    }
    case 'pyserial': {
      return {
        file: adapter.file,
        args: ['-I', adapter.script, 'serial', ...args],
        readyWord: 'serial-ready',
        writable: true,
      }
    }
    case 'posix-raw':
    case 'stty': {
      throw new Error('serial-line-settings-unsupported')
    }
  }
}

/** stty opens the port too, so this runs only inside an approved connect. */
export function serialSttyCommand(
  adapter: SerialAdapter,
  platform: NodeJS.Platform,
  _port: string,
  _settings: SerialLineSettings,
): SerialCommand | undefined {
  if (adapter.kind !== 'stty' && adapter.kind !== 'posix-raw') return undefined
  if (platform !== 'linux' && platform !== 'darwin') throw new Error('serial-stty-platform-invalid')
  // stty opens before a helper could apply approved DTR/RTS states.
  throw new Error('serial-line-settings-unsupported')
}

/** Selection uses tools the host discovered; writes need transparent binary IO. */
export function selectSerialAdapter(
  available: readonly SerialAdapter[],
  isWriteNeeded: boolean,
): SerialAdapter {
  for (const kind of ['pio', 'windows', 'pyserial']) {
    const adapter = available.find(
      (entry) => entry.kind === kind && (!isWriteNeeded || entry.kind !== 'pio'),
    )
    if (adapter !== undefined) return adapter
  }
  throw new Error('serial-adapter-unavailable')
}
