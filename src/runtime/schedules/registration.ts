// OS manifests contain only the trusted installed launcher and fixed arguments.
import { createHash } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  ACP_AGENT_TITLE,
  MILLISECONDS_PER_SECOND,
  SCHEDULE_MIN_INTERVAL_MS,
  UI_TEXT,
} from '../../shared/constants'
import { escapeHtml as xml } from '../../core/htmlText'
import { fill } from '../../shared/l10n/text'

class UnsafeScheduleLauncherError extends Error {
  override name = 'UnsafeScheduleLauncherError'
  constructor(file: string) {
    super(fill(UI_TEXT.scheduleV2.runtime.unsafeLauncher, { path: file }))
  }
}

export function unsafeScheduleLauncher(file: string): Error {
  return new UnsafeScheduleLauncherError(file)
}

export { scheduleLauncherReason } from './settle'

export interface BackgroundRegistrationInput {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly dataDir: string
  readonly executable: string
  readonly agentFile: string
  readonly uid: number
  readonly effectiveUid?: number
  readonly windowsUserId?: string
  readonly nowMs: number
  readonly nextWakeAtMs: number
}
export interface BackgroundRegistration {
  readonly id: string
  readonly domain: string
  readonly wakeAtMs: number
  readonly files: readonly {
    readonly path: string
    readonly text: string
    readonly encoding?: 'utf16le'
  }[]
}

export interface ScheduleWakeAuthorization {
  readonly scheduledPrompts: boolean
  readonly maxBudgetUsd?: number
}

export const backgroundWakeRecordSchema = z.strictObject({
  id: z.string(),
  nextWakeAtMs: z.int().check(z.gte(0)),
  executable: z.string(),
  agentFile: z.string(),
  files: z.array(
    z.strictObject({ path: z.string(), sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/)) }),
  ),
  definitionSha256: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  disabledAtMs: z.optional(z.int().check(z.gte(0))),
  nativeDisabledAtMs: z.optional(z.int().check(z.gte(0))),
  scheduledPrompts: z.optional(z.boolean()),
  maxBudgetUsd: z.optional(z.number().check(z.gt(0))),
})

export function backgroundDefinitionPaths(
  platform: NodeJS.Platform,
  homeDir: string,
  dataDir: string,
): readonly string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  const id = backgroundRegistrationId(homeDir)
  if (platform === 'win32') return [p.join(dataDir, `${id}.xml`)]
  return platform === 'darwin'
    ? [p.join(homeDir, 'Library', 'LaunchAgents', `${id}.plist`)]
    : ['service', 'timer'].map((extension) =>
        p.join(homeDir, '.config', 'systemd', 'user', `${id}.${extension}`),
      )
}

export function backgroundRecordPath(platform: NodeJS.Platform, dataDir: string): string {
  return (platform === 'win32' ? path.win32 : path.posix).join(dataDir, 'background-wake.json')
}

export function backgroundRegistrationId(homeDir: string): string {
  return `muse-spark-code-schedules-${createHash('sha256').update(homeDir).digest('hex')}`
}

function windowsArgument(text: string): string {
  return `"${text.replaceAll(/(\\*)"/g, String.raw`$1$1\"`).replaceAll(/(\\+)$/g, '$1$1')}"`
}
function systemdArgument(text: string): string {
  // systemd specifiers and environment expansion are not allowed to interpret paths.
  return `"${text
    .replaceAll('\\', '\\\\')
    .replaceAll('"', String.raw`\"`)
    .replaceAll('%', '%%')
    .replaceAll('$', () => '$$')}"`
}

export function backgroundRegistration(input: BackgroundRegistrationInput): BackgroundRegistration {
  const p = input.platform === 'win32' ? path.win32 : path.posix
  if (
    !['win32', 'darwin', 'linux'].includes(input.platform) ||
    !p.isAbsolute(input.executable) ||
    !p.isAbsolute(input.agentFile) ||
    !p.isAbsolute(input.homeDir) ||
    !p.isAbsolute(input.dataDir) ||
    /[\p{Cc}]/u.test(input.executable + input.agentFile + input.homeDir + input.dataDir) ||
    !Number.isSafeInteger(input.uid) ||
    input.uid < 0 ||
    (input.platform !== 'win32' && (input.uid === 0 || input.effectiveUid === 0)) ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0 ||
    !Number.isSafeInteger(input.nextWakeAtMs) ||
    input.nextWakeAtMs <= input.nowMs ||
    !Number.isFinite(new Date(input.nextWakeAtMs).getTime()) ||
    (input.platform === 'win32' &&
      !/^S-1-(?:5-21|12-1)-\d+(?:-\d+)+$/.test(input.windowsUserId ?? ''))
  )
    throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
  const id = backgroundRegistrationId(input.homeDir)
  const args = [input.agentFile, 'schedule', 'run-due', '--json', '--registration', id]
  if (input.platform === 'win32') {
    const text = `<?xml version="1.0" encoding="UTF-16"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><TimeTrigger><StartBoundary>${new Date(input.nextWakeAtMs).toISOString()}</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers><Principals><Principal id="Owner"><UserId>${xml(input.windowsUserId ?? '')}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable></Settings><Actions Context="Owner"><Exec><Command>${xml(input.executable)}</Command><Arguments>${xml(args.map((arg) => windowsArgument(arg)).join(' '))}</Arguments></Exec></Actions></Task>`
    return {
      id,
      domain: '',
      wakeAtMs: input.nextWakeAtMs,
      files: [{ path: p.join(input.dataDir, `${id}.xml`), text, encoding: 'utf16le' }],
    }
  }
  if (input.platform === 'darwin') {
    // launchd's calendar has minute precision. Round up, never wake before due.
    const wakeAtMs =
      Math.ceil(input.nextWakeAtMs / SCHEDULE_MIN_INTERVAL_MS) * SCHEDULE_MIN_INTERVAL_MS
    const date = new Date(wakeAtMs)
    const fields = {
      Month: date.getMonth() + 1,
      Day: date.getDate(),
      Hour: date.getHours(),
      Minute: date.getMinutes(),
    }
    const text = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${id}</string><key>ProgramArguments</key><array>${[input.executable, ...args].map((a) => `<string>${xml(a)}</string>`).join('')}</array><key>StartCalendarInterval</key><dict>${Object.entries(
      fields,
    )
      .map(([k, v]) => `<key>${k}</key><integer>${String(v)}</integer>`)
      .join('')}</dict><key>ProcessType</key><string>Background</string></dict></plist>`
    return {
      id,
      domain: `gui/${String(input.uid)}`,
      wakeAtMs,
      files: [{ path: p.join(input.homeDir, 'Library', 'LaunchAgents', `${id}.plist`), text }],
    }
  }
  const directory = p.join(input.homeDir, '.config', 'systemd', 'user')
  const wakeAtMs = Math.ceil(input.nextWakeAtMs / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND
  const calendar = new Date(wakeAtMs)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC')
  const description = `${ACP_AGENT_TITLE}: ${UI_TEXT.scheduleV2.labels.title}`
  return {
    id,
    domain: '',
    wakeAtMs,
    files: [
      {
        path: p.join(directory, `${id}.service`),
        text: `[Unit]\nDescription=${description}\n[Service]\nType=oneshot\nExecStart=${[input.executable, ...args].map((arg) => systemdArgument(arg)).join(' ')}\n`,
      },
      {
        path: p.join(directory, `${id}.timer`),
        text: `[Unit]\nDescription=${description}\n[Timer]\nOnCalendar=${calendar}\nPersistent=true\nAccuracySec=1s\nUnit=${id}.service\n[Install]\nWantedBy=timers.target\n`,
      },
    ],
  }
}
