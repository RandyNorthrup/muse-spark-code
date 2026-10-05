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
      return {
        file: adapter.file,
        args: ['monitor', '--port', port, '--config', `baudrate=${baud}`, '--quiet'],
        writable: false,
      }
    }
    case 'windows': {
      return {
        file: adapter.file,
        args: ['serial', ...args],
        readyWord: 'serial-ready',
        writable: true,
      }
    }
    case 'pyserial':
    case 'posix-raw': {
      return {
        file: adapter.file,
        args: ['-I', adapter.script, adapter.kind === 'pyserial' ? 'serial' : 'raw', ...args],
        readyWord: 'serial-ready',
        writable: true,
      }
    }
    case 'stty': {
      // Fixed script; the port is a positional argument, never shell source.
      // Both cat children stay in the parent's process group for Stop/deadline.
      return {
        file: adapter.shell,
        args: [
          '-c',
          String.raw`exec 3<> "$1" || exit 1; printf "serial-ready\n" >&2; cat <&3 & serial_reader=$!; cat >&3; kill "$serial_reader"; wait "$serial_reader" 2>/dev/null`,
          'muse-serial',
          port,
        ],
        readyWord: 'serial-ready',
        writable: true,
      }
    }
  }
}

/** stty opens the port too, so this runs only inside an approved connect. */
export function serialSttyCommand(
  adapter: SerialAdapter,
  platform: NodeJS.Platform,
  port: string,
  settings: SerialLineSettings,
): SerialCommand | undefined {
  if (adapter.kind !== 'stty' && adapter.kind !== 'posix-raw') return undefined
  if (platform !== 'linux' && platform !== 'darwin') throw new Error('serial-stty-platform-invalid')
  return {
    file: adapter.kind === 'stty' ? adapter.file : '/bin/stty',
    args: [
      platform === 'darwin' ? '-f' : '-F',
      port,
      String(settings.baud),
      'raw',
      '-echo',
      '-hupcl',
      'cs8',
      '-parenb',
      '-cstopb',
    ],
    writable: false,
  }
}

/** Selection uses tools the host discovered; writes need transparent binary IO. */
export function selectSerialAdapter(
  available: readonly SerialAdapter[],
  isWriteNeeded: boolean,
): SerialAdapter {
  for (const kind of ['pio', 'arduino-cli', 'windows', 'pyserial', 'posix-raw', 'stty']) {
    const adapter = available.find(
      (entry) =>
        entry.kind === kind &&
        (!isWriteNeeded || (entry.kind !== 'pio' && entry.kind !== 'arduino-cli')),
    )
    if (adapter !== undefined) return adapter
  }
  throw new Error('serial-adapter-unavailable')
}
