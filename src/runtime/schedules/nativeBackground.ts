import { createHash } from 'node:crypto'
import process from 'node:process'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import {
  scheduleBackgroundConsentSchema,
  type ScheduleBackgroundPort,
} from '../../shared/scheduleV2'
import {
  backgroundRegistration,
  backgroundRegistrationId,
  backgroundDefinitionPaths,
  backgroundRecordPath,
  backgroundWakeRecordSchema,
  unsafeScheduleLauncher,
  type ScheduleWakeAuthorization,
  type BackgroundRegistrationInput,
} from './registration'

export interface BackgroundFilePort {
  readonly trustedPath: (
    file: string,
    platform: NodeJS.Platform,
    uid: number,
    kind?: 'definition' | 'directory',
  ) => Promise<string>
  prepare(file: string, platform: NodeJS.Platform, uid: number): Promise<void>
  hash(file: string): Promise<string | undefined>
  waitForWake(dataDir: string, shouldWait?: boolean): Promise<void>
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
  /** S supplies persisted explicit authorization, never a draft or native argument. */
  readonly authorization: () => Promise<ScheduleWakeAuthorization>
  readonly run: (file: string, args: readonly string[]) => Promise<BackgroundProcessResult>
}

/** All mutating calls are serialized by BackgroundCoordinator's durable lock. */
export class NativeScheduleBackground implements ScheduleBackgroundPort {
  private readonly id: string
  private readonly stateFile: string
  private readonly paths: readonly string[]
  constructor(private readonly deps: NativeBackgroundDeps) {
    this.id = backgroundRegistrationId(deps.homeDir)
    this.stateFile = backgroundRecordPath(deps.platform, deps.dataDir)
    this.paths = backgroundDefinitionPaths(deps.platform, deps.homeDir, deps.dataDir)
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
      "$ErrorActionPreference = 'Stop'; $identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = [Security.Principal.WindowsPrincipal]::new($identity); ConvertTo-Json -Compress -InputObject @{ sid = $identity.User.Value; elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); service = $identity.IsSystem -or ($identity.Groups.Value -contains 'S-1-5-6') }"
    const input = await this.powershellJson(script)
    const identity = z
      .strictObject({
        sid: z.string().check(z.regex(/^S-1-(?:5-21|12-1)-\d+(?:-\d+)+$/)),
        elevated: z.boolean(),
        service: z.boolean(),
      })
      .parse(input)
    if (identity.elevated || identity.service)
      throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    return identity.sid
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
  private async assertLaunchdIdle(): Promise<void> {
    // A newly starting wake may not have published its lock yet. Protect it too.
    const result = await this.deps.run('launchctl', [
      'print',
      `gui/${String(this.deps.uid)}/${this.id}`,
    ])
    if (result.exitCode !== 0 && !result.stderr.includes('Could not find service'))
      throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    if (/^\s*(?:pid\s*=\s*[1-9]\d*|state\s*=\s*running)\s*$/m.test(result.stdout))
      throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
  }
  async status(): Promise<{ registered: boolean; nextWakeAtMs?: number }> {
    if (!(await this.isRegistered())) return { registered: false }
    const stored = await this.deps.files.read(this.stateFile)
    if (stored === undefined) return { registered: true }
    const input: unknown = JSON.parse(stored)
    return { registered: true, nextWakeAtMs: backgroundWakeRecordSchema.parse(input).nextWakeAtMs }
  }
  async register(
    nextWakeAtMs: number,
    input: z.infer<typeof scheduleBackgroundConsentSchema>,
  ): Promise<void> {
    if (this.deps.platform === 'darwin' && this.deps.isWakeProcess)
      throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
    const consent = scheduleBackgroundConsentSchema.parse(input)
    if (consent.choice !== 'yes') throw new Error(UI_TEXT.scheduleV2.runtime.consentRequired)
    const effectiveUid =
      this.deps.effectiveUid ??
      (this.deps.platform === process.platform ? process.geteuid?.() : this.deps.uid)
    if ((effectiveUid === 0 || this.deps.uid === 0) && this.deps.platform !== 'win32')
      throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    if (this.deps.platform === 'darwin') {
      await this.deps.files.waitForWake(this.deps.dataDir, false)
      await this.assertLaunchdIdle()
    }
    const windowsUserId = this.deps.platform === 'win32' ? await this.windowsOwnerId() : undefined
    const executable = await this.deps.files.trustedPath(
      this.deps.executable,
      this.deps.platform,
      this.deps.uid,
    )
    const agentFile = await this.deps.files.trustedPath(
      this.deps.agentFile,
      this.deps.platform,
      this.deps.uid,
    )
    const registration = backgroundRegistration({
      ...this.deps,
      ...(windowsUserId !== undefined && { windowsUserId }),
      executable,
      agentFile,
      nowMs: this.deps.now(),
      nextWakeAtMs,
    })
    const firstFile = registration.files[0]
    if (firstFile === undefined) throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    const authorization = await this.deps.authorization()
    if (
      authorization.scheduledPrompts &&
      (authorization.maxBudgetUsd === undefined ||
        !Number.isFinite(authorization.maxBudgetUsd) ||
        authorization.maxBudgetUsd <= 0)
    )
      throw new Error(UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired)
    const record = backgroundWakeRecordSchema.parse({
      id: this.id,
      nextWakeAtMs: registration.wakeAtMs,
      executable,
      agentFile,
      scheduledPrompts: authorization.scheduledPrompts,
      ...(authorization.maxBudgetUsd !== undefined && { maxBudgetUsd: authorization.maxBudgetUsd }),
      files: registration.files.map((file) => ({
        path: file.path,
        sha256: createHash('sha256')
          .update(
            file.encoding === 'utf16le'
              ? Buffer.from(`\u{FEFF}${file.text}`, 'utf16le')
              : file.text,
          )
          .digest('hex'),
      })),
    })
    for (const file of [...this.paths, this.stateFile])
      await this.deps.files.prepare(file, this.deps.platform, this.deps.uid)
    for (const file of registration.files)
      await this.deps.files.write(file.path, file.text, file.encoding)
    await this.deps.files.write(this.stateFile, JSON.stringify(record))
    const verify = async () => {
      for (const file of [
        ...record.files,
        {
          path: this.stateFile,
          sha256: createHash('sha256').update(JSON.stringify(record)).digest('hex'),
        },
      ]) {
        await this.deps.files.trustedPath(
          file.path,
          this.deps.platform,
          this.deps.uid,
          'definition',
        )
        if ((await this.deps.files.hash(file.path)) !== file.sha256)
          throw unsafeScheduleLauncher(file.path)
      }
    }
    await verify()
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
        await this.assertLaunchdIdle()
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
    await verify()
  }
  async remove(): Promise<void> {
    if (this.deps.platform === 'darwin' && this.deps.isWakeProcess)
      throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
    if (this.deps.platform === 'darwin') {
      await this.deps.files.waitForWake(this.deps.dataDir, false)
      await this.assertLaunchdIdle()
    }
    if (this.deps.platform === 'linux') {
      // Disabled does not mean inactive: stop both units before unlinking either.
      for (const operation of ['stop', 'disable']) {
        const result = await this.deps.run('systemctl', [
          '--user',
          operation,
          `${this.id}.timer`,
          `${this.id}.service`,
        ])
        if (result.exitCode !== 0 && !/not (?:loaded|found)|does not exist/.test(result.stderr))
          throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      }
    } else if (await this.isRegistered()) {
      switch (this.deps.platform) {
        case 'win32': {
          await this.succeeded('schtasks.exe', ['/Delete', '/TN', this.id, '/F'])
          break
        }
        case 'darwin': {
          await this.succeeded('launchctl', ['bootout', `gui/${String(this.deps.uid)}/${this.id}`])
          break
        }
        default: {
          throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
        }
      }
      if (await this.isRegistered()) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    }
    for (const file of [...this.paths, this.stateFile]) await this.deps.files.remove(file)
    if (this.deps.platform !== 'linux') {
      return
    }

    await this.succeeded('systemctl', ['--user', 'daemon-reload'])
    for (const unit of [`${this.id}.timer`, `${this.id}.service`]) {
      const result = await this.deps.run('systemctl', ['--user', 'is-active', unit])
      if (!['inactive', 'unknown'].includes(result.stdout.trim()) || result.exitCode === 0)
        throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      const enabled = await this.deps.run('systemctl', ['--user', 'is-enabled', unit])
      if (enabled.stdout.trim() !== 'not-found' || enabled.exitCode === 0)
        throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    }
  }
}
