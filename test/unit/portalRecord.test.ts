// M105 RLF-RECORDING: the Linux portal recorder, native half and host port.
// The helper is built from the shipped C source with the product's own build
// script and run for real against a real session bus (dbus-daemon, started
// here on a private address) and a real decoder (dbus-monitor, which prints
// every message it sees by the D-Bus type signature, independent of our
// encoder). No desktop portal is on that bus, so nothing records and no
// picker opens: what is proved is that the helper authenticates, says Hello,
// probes the portal honestly, and sends the ScreenCast calls exactly as the
// interface documents them, and that the host port reads that answer, keeps
// its recordings owner-only and fails closed. The picker, the descriptor and
// the encoder run on a desktop with xdg-desktop-portal (the owner-device
// receipt).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildPortalRecord } from '../../scripts/build-portal-record.mjs'
import { createLinuxRecorderPort } from '../../src/host/media/linuxRecorderPort'
import { UI_TEXT } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const DBUS_DAEMON = ['/usr/bin/dbus-daemon', '/usr/local/bin/dbus-daemon'].find(existsSync)
const DBUS_MONITOR = ['/usr/bin/dbus-monitor', '/usr/local/bin/dbus-monitor'].find(existsSync)
/** One compile of the C file by the system compiler. */
const BUILD_TIMEOUT_MS = 60_000
const MEBIBYTE = 1024 * 1024
const PERMISSION_BITS = 0o777
/** What the video pipeline names (linuxRecorderPort's probe list). */
const VIDEO_ELEMENTS = [
  'pipewiresrc',
  'videoconvert',
  'x264enc',
  'h264parse',
  'queue',
  'mp4mux',
  'filesink',
]

function noOutput(): string {
  return ''
}

interface Finished {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** A child's whole output, collected as it arrives; `finished` settles at its close. */
function collect(child: ChildProcess): {
  readonly output: () => string
  readonly finished: Promise<Finished>
} {
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  return {
    output: () => stdout,
    finished: new Promise((resolve) => {
      child.on('close', (code) => {
        resolve({ code, stdout, stderr })
      })
    }),
  }
}

describe.skipIf(process.platform !== 'linux')('M105 R3 portal recorder (native)', () => {
  let root = ''
  let helper = ''
  const hasSessionBus = existsSync(`/run/user/${String(process.getuid?.() ?? 0)}/bus`)

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'muse-portal-record-test-'))
    // The layout the package ships: <extension>/native/linux/<arch>/muse-portal-record.
    const native = path.join(root, 'native', 'linux', process.arch)
    buildPortalRecord(native)
    helper = path.join(native, 'muse-portal-record')
  }, BUILD_TIMEOUT_MS)
  afterAll(() => removeFolder(root))

  /** The helper with a pipe on stdin; ending that pipe cancels a waiting run. */
  const runHelper = (args: readonly string[], environment: NodeJS.ProcessEnv) => {
    const child = spawn(helper, [...args], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] })
    return { child, ...collect(child) }
  }

  it('answers its self-test and refuses arguments it does not know', async () => {
    const selfTest = runHelper(['--self-test'], {})
    expect(await selfTest.finished).toMatchObject({
      code: 0,
      stdout: 'muse-portal-record-ready\n',
    })
    const unknown = runHelper(['--record'], {})
    expect(await unknown.finished).toMatchObject({ code: 2 })
    const relative = runHelper(
      ['--portal', '--encoder', 'gst-launch-1.0', '--max-bytes', '1', '--max-seconds', '0'],
      {},
    )
    expect(await relative.finished).toMatchObject({ code: 2 })
  })

  it.skipIf(hasSessionBus)('says there is no session bus when none answers', async () => {
    const missing = path.join(tmpdir(), 'muse-portal-record-no-bus')
    const probe = await runHelper(['--probe'], {
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${missing}`,
      XDG_RUNTIME_DIR: root,
    }).finished
    expect(probe).toMatchObject({ code: 1, stdout: '' })
    expect(probe.stderr).toContain('no session bus')
  })

  const portFor = (extensionPath: string, environment: NodeJS.ProcessEnv, remoteName?: string) =>
    createLinuxRecorderPort({
      extensionPath,
      tempRoot: path.join(root, 'recordings'),
      arch: process.arch,
      environment,
      remoteName,
      signal: new AbortController().signal,
      l10n: { table: UI_TEXT, locale: 'en' },
      maxBytes: () => MEBIBYTE,
    })

  describe('host port', () => {
    it('keeps each recording in its own owner-only folder and removes it whole', async () => {
      const port = portFor(root, {})
      const first = await port.createPrivateRecording()
      const second = await port.createPrivateRecording()
      expect(path.dirname(first.path)).not.toBe(path.dirname(second.path))
      const folder = await stat(path.dirname(first.path))
      const file = await stat(first.path)
      expect(folder.mode & PERMISSION_BITS).toBe(0o700)
      expect(file.mode & PERMISSION_BITS).toBe(0o600)
      expect(file.size).toBe(0)
      await first.remove()
      await second.remove()
      await expect(stat(path.dirname(first.path))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('records only from a local desktop session', () => {
      expect(portFor(root, { DISPLAY: ':0' }).localScreen()).toBe(true)
      expect(portFor(root, { WAYLAND_DISPLAY: 'wayland-0' }).localScreen()).toBe(true)
      expect(portFor(root, {}).localScreen()).toBe(false)
      expect(portFor(root, { DISPLAY: ':0' }, 'ssh-remote').localScreen()).toBe(false)
    })

    it('finds GStreamer exactly when this machine can run the pipeline it names', async () => {
      const launch = ['/usr/bin', '/usr/local/bin', '/bin']
        .map((directory) => path.join(directory, 'gst-launch-1.0'))
        .find(existsSync)
      const found = await portFor(root, {}).findEncoder({ microphone: false, systemAudio: false })
      if (launch === undefined) {
        expect(found).toBeUndefined()
        return
      }
      // The machine's own answer for each element the video pipeline names.
      const inspect = path.join(path.dirname(launch), 'gst-inspect-1.0')
      const canRun = VIDEO_ELEMENTS.every((element) => {
        try {
          execFileSync(inspect, ['--exists', element], { stdio: 'ignore' })
          return true
        } catch {
          return false
        }
      })
      expect(found !== undefined).toBe(canRun)
    })

    it('opens no portal without a bound encoder, saying the portal is not there', async () => {
      await expect(
        portFor(root, {}).openPortal(
          { maxSeconds: 0, microphone: false, systemAudio: false },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ name: 'NotFoundError' })
    })

    it('offers no portal when the helper is not shipped', async () => {
      const empty = await mkdtemp(path.join(root, 'empty-'))
      await expect(portFor(empty, { DISPLAY: ':0' }).hasPortal()).resolves.toBe(false)
    })
  })

  describe.skipIf(DBUS_DAEMON === undefined || DBUS_MONITOR === undefined)('on a real bus', () => {
    let daemon: ChildProcess | undefined
    let monitor: ChildProcess | undefined
    let monitored = noOutput
    let environment: NodeJS.ProcessEnv = {}

    beforeAll(async () => {
      const address = `unix:path=${path.join(root, 'bus.sock')}`
      daemon = spawn(
        DBUS_DAEMON ?? '',
        ['--session', '--nofork', '--print-address=1', `--address=${address}`],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      )
      const daemonOutput = collect(daemon).output
      await vi.waitFor(() => {
        expect(daemonOutput()).toContain('unix:')
      })
      environment = { DBUS_SESSION_BUS_ADDRESS: address, XDG_RUNTIME_DIR: root }
      monitor = spawn(DBUS_MONITOR ?? '', ['--session'], {
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      monitored = collect(monitor).output
      // The monitor is on the bus once the daemon has told it its name.
      await vi.waitFor(() => {
        expect(monitored()).toContain('NameAcquired')
      })
    })
    afterAll(() => {
      monitor?.kill()
      daemon?.kill()
    })

    it('connects, authenticates and says Hello, then says the portal is not there', async () => {
      const probe = await runHelper(['--probe'], environment).finished
      expect(probe).toMatchObject({ code: 1, stdout: '' })
      expect(probe.stderr).toContain('no xdg-desktop-portal ScreenCast')
    })

    it('lets the host port read that answer: the desktop has no portal', async () => {
      await expect(portFor(root, { ...environment, DISPLAY: ':0' }).hasPortal()).resolves.toBe(
        false,
      )
    })

    it('sends CreateSession as the ScreenCast interface documents it and ends unavailable', async () => {
      const portal = runHelper(
        [
          '--portal',
          '--encoder',
          '/usr/bin/gst-launch-1.0',
          '--max-bytes',
          '1048576',
          '--max-seconds',
          '0',
        ],
        environment,
      )
      const finished = await portal.finished
      expect(finished).toMatchObject({
        code: 1,
        stdout: '{"type":"error","code":"unavailable"}\n',
      })
      // The bus answered the call with its own error; the monitor saw both.
      await vi.waitFor(() => {
        expect(monitored()).toContain('error_name=org.freedesktop.DBus.Error.ServiceUnknown')
      })
      const call = monitored().slice(monitored().indexOf('member=CreateSession'))
      // a{sv} with both tokens, as dbus-monitor decodes the wire message.
      expect(call).toMatch(
        /^member=CreateSession\n\s+array \[\n\s+dict entry\(\n\s+string "handle_token"\n\s+variant\s+string "muse_spark_\d+_\d+"\n\s+\)\n\s+dict entry\(\n\s+string "session_handle_token"\n\s+variant\s+string "muse_spark_\d+_\d+"/u,
      )
      expect(monitored()).toContain('destination=org.freedesktop.portal.Desktop')
    })
  })
})
