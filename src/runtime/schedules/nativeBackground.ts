import { nonnegativeUsdSchema } from '../../shared/usdSchema'
import { createHash } from 'node:crypto'
import process from 'node:process'
import path from 'node:path'
import * as z from 'zod/mini'
import { SCHEDULE_MIN_INTERVAL_MS, UI_TEXT } from '../../shared/constants'
import {
  effectiveBackgroundDefinition,
  scheduleWindowsOwner,
  verifySystemdSearchDirectories,
} from './effectiveDefinition'
import { WINDOWS_TRUSTED_ACL_SCRIPT } from '../windowsTrustedPath'
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
    kind?: 'definition' | 'directory' | 'search-directory',
  ) => Promise<string>
  prepare(file: string, platform: NodeJS.Platform, uid: number): Promise<void>
  readonly hash: (file: string) => Promise<string | undefined>
  waitForWake(dataDir: string, shouldWait?: boolean): Promise<void>
  readonly read: (file: string) => Promise<string | undefined>
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
  private async writeRecord(record: z.infer<typeof backgroundWakeRecordSchema>): Promise<void> {
    const text = JSON.stringify(record)
    await this.deps.files.write(this.stateFile, text)
    await this.deps.files.trustedPath(
      this.stateFile,
      this.deps.platform,
      this.deps.uid,
      'definition',
    )
    if (
      (await this.deps.files.hash(this.stateFile)) !==
      createHash('sha256').update(text).digest('hex')
    )
      throw unsafeScheduleLauncher(this.stateFile)
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
  private async isRegistered(): Promise<boolean> {
    switch (this.deps.platform) {
      case 'win32': {
        // Only our boolean crosses stdout, never the user's task inventory.
        const script = `$ErrorActionPreference = 'Stop'; $found = @(Get-ScheduledTask | Where-Object { $_.TaskName -eq '${this.id}' -and $_.TaskPath -eq '${path.win32.join(path.win32.sep, this.id)}${path.win32.sep}' }); ConvertTo-Json -Compress -InputObject ([bool]($found.Count -gt 0))`
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
  private async retireLaunchd(): Promise<boolean> {
    const stored = await this.deps.files.read(this.stateFile)
    if (stored === undefined) {
      if (await this.isRegistered()) throw unsafeScheduleLauncher(this.stateFile)
      return true
    }
    await this.deps.files.trustedPath(
      this.stateFile,
      this.deps.platform,
      this.deps.uid,
      'definition',
    )
    let record = backgroundWakeRecordSchema.parse(JSON.parse(stored))
    const effective = await this.definition(record.executable)
    if (
      record.id !== this.id ||
      record.definitionSha256 !== effective.sha256 ||
      JSON.stringify(record.files) !== JSON.stringify(effective.files)
    )
      throw unsafeScheduleLauncher(this.stateFile)
    // Disable first: prevent a new start between the final idle print and bootout.
    // A wake already starting must observe the disabled record before admission.
    await this.succeeded('launchctl', ['disable', `gui/${String(this.deps.uid)}/${this.id}`])
    if (record.disabledAtMs === undefined || record.nativeDisabledAtMs === undefined) {
      record = {
        ...record,
        disabledAtMs: record.disabledAtMs ?? this.deps.now(),
        nativeDisabledAtMs: record.nativeDisabledAtMs ?? this.deps.now(),
      }
      await this.writeRecord(record)
    }
    const disabledSince = record.nativeDisabledAtMs
    if (disabledSince === undefined || this.deps.now() - disabledSince < SCHEDULE_MIN_INTERVAL_MS)
      return false
    await this.deps.files.waitForWake(this.deps.dataDir, false)
    // One reconciliation under the caller's durable registration lock; no second
    // existence query that discards a running/starting state before bootout.
    const result = await this.deps.run('launchctl', [
      'print',
      `gui/${String(this.deps.uid)}/${this.id}`,
    ])
    if (result.exitCode !== 0) {
      if (result.stderr.includes('Could not find service')) return true
      throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    }
    if (
      /^\s*(?:pid\s*=\s*[1-9]\d*|state\s*=\s*(?:running|spawn scheduled|starting))\s*$/m.test(
        result.stdout,
      )
    )
      return false
    if (!/^\s*state\s*=\s*(?:not running|waiting|exited)\s*$/m.test(result.stdout))
      throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    await this.succeeded('launchctl', ['bootout', `gui/${String(this.deps.uid)}/${this.id}`])
    return true
  }
  private definition(executable: string) {
    return effectiveBackgroundDefinition({
      platform: this.deps.platform,
      id: this.id,
      definitions: this.paths,
      executable,
      uid: this.deps.uid,
      trustedPath: this.deps.files.trustedPath,
      hash: this.deps.files.hash,
      read: this.deps.files.read,
      run: this.deps.run,
    })
  }
  async status(): Promise<{ registered: boolean; nextWakeAtMs?: number }> {
    if (!(await this.isRegistered())) return { registered: false }
    const stored = await this.deps.files.read(this.stateFile)
    if (stored === undefined) return { registered: true }
    const input: unknown = JSON.parse(stored)
    const record = backgroundWakeRecordSchema.parse(input)
    return record.disabledAtMs === undefined
      ? { registered: true, nextWakeAtMs: record.nextWakeAtMs }
      : { registered: true }
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
    const authorization = await this.deps.authorization()
    if (
      authorization.scheduledPrompts &&
      (authorization.maxBudgetUsd === undefined ||
        !nonnegativeUsdSchema.safeParse(authorization.maxBudgetUsd).success ||
        authorization.maxBudgetUsd === '0')
    )
      throw new Error(UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired)
    if (this.deps.platform === 'darwin') {
      await this.deps.files.waitForWake(this.deps.dataDir, false)
      if (!(await this.retireLaunchd()))
        throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
    }
    const windowsUserId =
      this.deps.platform === 'win32' ? await scheduleWindowsOwner(this.deps.run) : undefined
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
    try {
      if (this.deps.platform === 'linux')
        await verifySystemdSearchDirectories({
          ...this.deps,
          id: this.id,
          definitions: this.paths,
          trustedPath: this.deps.files.trustedPath,
          read: this.deps.files.read,
          hash: this.deps.files.hash,
        })
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
      const recordInput = {
        id: this.id,
        nextWakeAtMs: registration.wakeAtMs,
        executable,
        agentFile,
        scheduledPrompts: authorization.scheduledPrompts,
        ...(authorization.maxBudgetUsd !== undefined && {
          maxBudgetUsd: authorization.maxBudgetUsd,
        }),
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
      }
      for (const file of [...this.paths, this.stateFile])
        await this.deps.files.prepare(file, this.deps.platform, this.deps.uid)
      for (const file of registration.files)
        await this.deps.files.write(file.path, file.text, file.encoding)
      const verifyStaged = async () => {
        for (const file of recordInput.files) {
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
      const saveRecord = async () => {
        const effective = await this.definition(executable)
        const record = backgroundWakeRecordSchema.parse({
          ...recordInput,
          files: effective.files,
          definitionSha256: effective.sha256,
        })
        await this.writeRecord(record)
        return record
      }
      await verifyStaged()
      let record
      switch (this.deps.platform) {
        case 'win32': {
          // The standard Task Scheduler root permits creation by other users.
          // Create our fixed per-user folder with a protected, trusted-SID DACL.
          const folderScript = String.raw`$ErrorActionPreference = 'Stop'; ${WINDOWS_TRUSTED_ACL_SCRIPT}; $scheduler = New-Object -ComObject 'Schedule.Service'; $scheduler.Connect(); $root = $scheduler.GetFolder('\'); $found = @($root.GetFolders(0) | Where-Object { $_.Name -eq '${this.id}' }); if ($found.Count -eq 0) { $null = $root.CreateFolder('${this.id}', 'O:${windowsUserId ?? ''}D:P(A;;FA;;;${windowsUserId ?? ''})(A;;FA;;;SY)(A;;FA;;;BA)') }; $folder = $scheduler.GetFolder('${path.win32.join(path.win32.sep, this.id)}'); $acl = [Security.AccessControl.DirectorySecurity]::new(); $acl.SetSecurityDescriptorSddlForm($folder.GetSecurityDescriptor(7)); $tasksTrusted = $true; foreach ($existingTask in @($folder.GetTasks(1) | Where-Object { $_.Name -eq '${this.id}' })) { $taskAcl = [Security.AccessControl.FileSecurity]::new(); $taskAcl.SetSecurityDescriptorSddlForm($existingTask.GetSecurityDescriptor(7)); $tasksTrusted = $tasksTrusted -and (Test-TrustedAcl $taskAcl $false $false $true) }; ConvertTo-Json -Compress -InputObject ((Test-TrustedAcl $acl $false $true $true) -and $tasksTrusted)`
          if (!z.boolean().parse(await this.powershellJson(folderScript)))
            throw unsafeScheduleLauncher(this.id)
          await this.succeeded('schtasks.exe', [
            '/Create',
            '/TN',
            path.win32.join(path.win32.sep, this.id, this.id),
            '/XML',
            firstFile.path,
            '/F',
          ])
          record = await saveRecord()
          break
        }
        case 'darwin': {
          record = await saveRecord()
          await this.succeeded('launchctl', ['enable', `${registration.domain}/${this.id}`])
          await this.succeeded('launchctl', ['bootstrap', registration.domain, firstFile.path])
          break
        }
        case 'linux': {
          await this.succeeded('systemctl', ['--user', 'daemon-reload'])
          record = await saveRecord()
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
      await verifyStaged()
      const effective = await this.definition(executable)
      if (
        record.definitionSha256 !== effective.sha256 ||
        JSON.stringify(record.files) !== JSON.stringify(effective.files)
      )
        throw unsafeScheduleLauncher(this.stateFile)
    } catch (error: unknown) {
      if (this.deps.platform === 'linux') {
        // Refused reconciliation must not leave the previous timer armed.
        const result = await this.deps.run('systemctl', [
          '--user',
          'disable',
          '--now',
          `${this.id}.timer`,
        ])
        if (result.exitCode !== 0 && !/not (?:loaded|found)|does not exist/.test(result.stderr))
          throw new Error(UI_TEXT.scheduleV2.runtime.unavailable, { cause: error })
      }
      throw error
    }
  }
  async remove(): Promise<void> {
    if (this.deps.platform === 'darwin' && this.deps.isWakeProcess)
      throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
    if (this.deps.platform === 'darwin') {
      if (!(await this.retireLaunchd()))
        throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
      for (const file of [...this.paths, this.stateFile]) await this.deps.files.remove(file)
      return
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
          await this.succeeded('schtasks.exe', [
            '/Delete',
            '/TN',
            path.win32.join(path.win32.sep, this.id, this.id),
            '/F',
          ])
          break
        }
        default: {
          throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
        }
      }
      if (await this.isRegistered()) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    }
    if (this.deps.platform === 'win32') {
      const script = String.raw`$ErrorActionPreference = 'Stop'; ${WINDOWS_TRUSTED_ACL_SCRIPT}; $scheduler = New-Object -ComObject 'Schedule.Service'; $scheduler.Connect(); $root = $scheduler.GetFolder('\'); $found = @($root.GetFolders(0) | Where-Object { $_.Name -eq '${this.id}' }); if ($found.Count -gt 0) { $acl = [Security.AccessControl.DirectorySecurity]::new(); $acl.SetSecurityDescriptorSddlForm($found[0].GetSecurityDescriptor(7)); if (-not (Test-TrustedAcl $acl $false $true $true)) { throw 'unsafe task folder' }; $root.DeleteFolder('${this.id}', 0) }; ConvertTo-Json -Compress -InputObject $true`
      if (!z.boolean().parse(await this.powershellJson(script)))
        throw unsafeScheduleLauncher(this.id)
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
