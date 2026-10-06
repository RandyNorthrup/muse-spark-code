import path from 'node:path'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import {
  scheduleBackgroundConsentSchema,
  type ScheduleBackgroundPort,
} from '../../shared/scheduleV2'
import {
  backgroundRegistration,
  backgroundRegistrationId,
  type BackgroundRegistrationInput,
} from './registration'

export interface BackgroundFilePort {
  read(file: string): Promise<string | undefined>
  write(file: string, text: string, encoding?: 'utf16le'): Promise<void>
  remove(file: string): Promise<void>
}
export interface BackgroundProcessResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}
export interface NativeBackgroundDeps extends Omit<
  BackgroundRegistrationInput,
  'nowMs' | 'nextWakeAtMs'
> {
  readonly now: () => number
  /** Set by the trusted runtime command, never by a schedule or event payload. */
  readonly isWakeProcess: boolean
  readonly files: BackgroundFilePort
  readonly run: (file: string, args: readonly string[]) => Promise<BackgroundProcessResult>
}
const wakeSchema = z.strictObject({ nextWakeAtMs: z.int().check(z.gte(0)) })

/** All mutating calls are serialized by BackgroundCoordinator's durable lock. */
export class NativeScheduleBackground implements ScheduleBackgroundPort {
  private readonly id: string
  private readonly stateFile: string
  private readonly paths: readonly string[]
  constructor(private readonly deps: NativeBackgroundDeps) {
    this.id = backgroundRegistrationId(deps.homeDir)
    const p = deps.platform === 'win32' ? path.win32 : path.posix
    this.stateFile = p.join(deps.dataDir, 'background-wake.json')
    const unixPaths =
      deps.platform === 'darwin'
        ? [p.join(deps.homeDir, 'Library', 'LaunchAgents', `${this.id}.plist`)]
        : [
            p.join(deps.homeDir, '.config', 'systemd', 'user', `${this.id}.service`),
            p.join(deps.homeDir, '.config', 'systemd', 'user', `${this.id}.timer`),
          ]
    this.paths = deps.platform === 'win32' ? [p.join(deps.dataDir, `${this.id}.xml`)] : unixPaths
  }
  private async succeeded(file: string, args: readonly string[]): Promise<void> {
    const result = await this.deps.run(file, args)
    if (result.exitCode !== 0) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
  }
  private async powershellJson(script: string): Promise<unknown> {
    const result = await this.deps.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ])
    if (result.exitCode !== 0) throw new Error(UI_TEXT.scheduleV2.runtime.backgroundUnavailable)
    return JSON.parse(result.stdout.trim())
  }
  private async windowsOwnerId(): Promise<string> {
    const script =
      "$ErrorActionPreference = 'Stop'; ConvertTo-Json -Compress -InputObject ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)"
    const input = await this.powershellJson(script)
    return z
      .string()
      .check(z.regex(/^S-1-\d+(?:-\d+)+$/))
      .parse(input)
  }
  private async isRegistered(): Promise<boolean> {
    switch (this.deps.platform) {
      case 'win32': {
        // Only our boolean crosses stdout, never the user's task inventory.
        const script = `$ErrorActionPreference = 'Stop'; $found = @(Get-ScheduledTask | Where-Object { $_.TaskName -eq '${this.id}' }); ConvertTo-Json -Compress -InputObject ([bool]($found.Count -gt 0))`
        return z.boolean().parse(await this.powershellJson(script))
      }
      case 'darwin': {
        const domain = `gui/${String(this.deps.uid)}`
        const result = await this.deps.run('launchctl', ['print', `${domain}/${this.id}`])
        if (result.exitCode === 0) return true
        if (result.stderr.includes('Could not find service')) return false
        throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      }
      case 'linux': {
        const result = await this.deps.run('systemctl', [
          '--user',
          'is-enabled',
          `${this.id}.timer`,
        ])
        const state = result.stdout.trim()
        if (state === 'enabled' && result.exitCode === 0) return true
        if (state === 'disabled' || state === 'not-found') return false
        throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      }
      default: {
        throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      }
    }
  }
  async status(): Promise<{ registered: boolean; nextWakeAtMs?: number }> {
    if (!(await this.isRegistered())) return { registered: false }
    const stored = await this.deps.files.read(this.stateFile)
    if (stored === undefined) return { registered: true }
    const input: unknown = JSON.parse(stored)
    return { registered: true, nextWakeAtMs: wakeSchema.parse(input).nextWakeAtMs }
  }
  async register(
    nextWakeAtMs: number,
    input: z.infer<typeof scheduleBackgroundConsentSchema>,
  ): Promise<void> {
    if (this.deps.platform === 'darwin' && this.deps.isWakeProcess)
      throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
    const consent = scheduleBackgroundConsentSchema.parse(input)
    if (consent.choice !== 'yes') throw new Error(UI_TEXT.scheduleV2.runtime.consentRequired)
    const registration = backgroundRegistration({
      ...this.deps,
      ...(this.deps.platform === 'win32' && { windowsUserId: await this.windowsOwnerId() }),
      nowMs: this.deps.now(),
      nextWakeAtMs,
    })
    const firstFile = registration.files[0]
    if (firstFile === undefined) throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    for (const file of registration.files)
      await this.deps.files.write(file.path, file.text, file.encoding)
    switch (this.deps.platform) {
      case 'win32': {
        await this.succeeded('schtasks.exe', [
          '/Create',
          '/TN',
          this.id,
          '/XML',
          firstFile.path,
          '/F',
        ])
        break
      }
      case 'darwin': {
        if (await this.isRegistered())
          await this.succeeded('launchctl', ['bootout', `${registration.domain}/${this.id}`])
        await this.succeeded('launchctl', ['bootstrap', registration.domain, firstFile.path])
        break
      }
      case 'linux': {
        await this.succeeded('systemctl', ['--user', 'daemon-reload'])
        await this.succeeded('systemctl', ['--user', 'enable', '--now', `${this.id}.timer`])
        // An already active one-shot timer must reread its changed calendar.
        await this.succeeded('systemctl', ['--user', 'restart', `${this.id}.timer`])
        break
      }
      default: {
        throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      }
    }
    if (!(await this.isRegistered())) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    await this.deps.files.write(
      this.stateFile,
      JSON.stringify({ nextWakeAtMs: registration.wakeAtMs }),
    )
  }
  async remove(): Promise<void> {
    if (this.deps.platform === 'darwin' && this.deps.isWakeProcess)
      throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
    if (await this.isRegistered()) {
      switch (this.deps.platform) {
        case 'win32': {
          await this.succeeded('schtasks.exe', ['/Delete', '/TN', this.id, '/F'])
          break
        }
        case 'darwin': {
          await this.succeeded('launchctl', ['bootout', `gui/${String(this.deps.uid)}/${this.id}`])
          break
        }
        case 'linux': {
          await this.succeeded('systemctl', ['--user', 'disable', '--now', `${this.id}.timer`])
          break
        }
        default: {
          throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
        }
      }
      if (await this.isRegistered()) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    }
    for (const file of [...this.paths, this.stateFile]) await this.deps.files.remove(file)
    if (this.deps.platform === 'linux')
      await this.succeeded('systemctl', ['--user', 'daemon-reload'])
  }
}
