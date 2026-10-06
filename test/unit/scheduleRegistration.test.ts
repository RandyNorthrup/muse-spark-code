import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import {
  backgroundRegistration,
  type BackgroundRegistrationInput,
} from '../../src/runtime/schedules/registration'

function input(platform: NodeJS.Platform): BackgroundRegistrationInput {
  const isWindows = platform === 'win32'
  return {
    platform,
    homeDir: isWindows ? String.raw`C:\Users\rig` : '/home/rig',
    dataDir: isWindows ? String.raw`C:\data` : '/data',
    executable: isWindows ? String.raw`C:\Node Space\node.exe` : '/opt/Node Space/node',
    agentFile: isWindows
      ? String.raw`C:\Agent & Space\dist\acp.js`
      : '/opt/Agent & Space/dist/acp.js',
    uid: 1000,
    ...(isWindows && { windowsUserId: 'S-1-5-21-1-2-3-1000' }),
    nowMs: Date.parse('2026-10-06T09:00:00Z'),
    nextWakeAtMs: Date.parse('2026-10-06T09:05:15.100Z'),
  }
}
describe('one-shot OS schedule manifests', () => {
  it('uses a least-privilege, nonrepeating Task Scheduler time trigger and quoted fixed arguments', () => {
    const value = input('win32'),
      r = backgroundRegistration(value),
      text = r.files[0]!.text
    expect(text).toContain(
      `<StartBoundary>${new Date(value.nextWakeAtMs).toISOString()}</StartBoundary>`,
    )
    expect(text).toContain('<RunLevel>LeastPrivilege</RunLevel>')
    expect(text).toContain('<UserId>S-1-5-21-1-2-3-1000</UserId>')
    expect(r.files[0]!.encoding).toBe('utf16le')
    expect(text).toContain(String.raw`C:\Agent &amp; Space\dist\acp.js`)
    expect(text).toContain('&quot;schedule&quot; &quot;run-due&quot; &quot;--json&quot;')
    expect(text).not.toMatch(/Repetition|HighestAvailable|META_API_KEY|KeepAlive/)
    expect(r.wakeAtMs).toBe(value.nextWakeAtMs)
  })
  it('uses a launchd calendar with no KeepAlive or RunAtLoad, rounding up to the minute', () => {
    const value = input('darwin'),
      r = backgroundRegistration(value),
      text = r.files[0]!.text
    expect(r.domain).toBe('gui/1000')
    expect(r.files[0]!.path).toMatch(/\/Library\/LaunchAgents\/.*\.plist$/)
    expect(text).toContain('<key>ProgramArguments</key>')
    expect(text).toContain(
      '<string>schedule</string><string>run-due</string><string>--json</string>',
    )
    expect(text).toContain('Agent &amp; Space')
    expect(text).not.toMatch(/KeepAlive|RunAtLoad|StartInterval|META_API_KEY/)
    expect(r.wakeAtMs).toBe(Date.parse('2026-10-06T09:06:00Z'))
  })
  it('uses a systemd user oneshot with one absolute UTC calendar and no credential or path expansion', () => {
    const value = { ...input('linux'), agentFile: '/opt/%h/$HOME/"Agent"/dist/acp.js' }
    const r = backgroundRegistration(value),
      [service, timer] = r.files
    expect(service!.text).toContain('Type=oneshot')
    expect(service!.text).toContain(String.raw`%%h/$$HOME/\"Agent\"`)
    expect(service!.text).toContain('"schedule" "run-due" "--json"')
    expect(timer!.text).toContain('OnCalendar=2026-10-06 09:05:16 UTC')
    expect(timer!.text).toContain('Persistent=true')
    expect(service!.text + timer!.text).not.toMatch(
      /OnUnitActiveSec|OnBootSec|Environment=|META_API_KEY/,
    )
    expect(r.wakeAtMs).toBeGreaterThanOrEqual(value.nextWakeAtMs)
  })
  it.each(['win32', 'darwin', 'linux'] as const)(
    'rejects unsafe launcher paths, invalid time and unsupported identity on %s',
    (platform) => {
      const base = input(platform)
      for (const changed of [
        { executable: 'relative' },
        { agentFile: 'relative' },
        { homeDir: 'relative' },
        { dataDir: 'relative' },
        { agentFile: base.agentFile + '\n--key' },
        { nextWakeAtMs: base.nowMs },
        { nextWakeAtMs: -1 },
        { nextWakeAtMs: base.nextWakeAtMs + 0.5 },
        { nextWakeAtMs: Number.MAX_SAFE_INTEGER },
        { uid: 1.5 },
        { uid: -1 },
        ...(platform === 'win32' ? [] : [{ uid: 0 }, { effectiveUid: 0 }]),
        { nowMs: NaN },
        { nowMs: -1 },
        ...(platform === 'win32'
          ? ['not-a-sid', 'S-1-5-18', 'S-1-5-19', 'S-1-5-20', 'S-1-5-80-1-2'].map(
              (windowsUserId) => ({ windowsUserId }),
            )
          : []),
        { platform: 'freebsd' as const },
      ])
        expect(() => backgroundRegistration({ ...base, ...changed })).toThrow(
          UI_TEXT.scheduleV2.runtime.invalidRequest,
        )
    },
  )
})
