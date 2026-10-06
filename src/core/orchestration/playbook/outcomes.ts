import { createHash } from 'node:crypto'
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  GIT_OUTPUT_MAX_BYTES,
  GIT_TIMEOUT_MS,
  PLAYBOOK_HOOK_NAMES,
  PLAYBOOK_HOOK_EXECUTABLE_MASK,
} from '../../../shared/constants'
import { UI_TEXT } from '../../../shared/l10n/text'
import type { PlaybookRecord, PlaybookPushRange } from '../../../shared/playbook'
import { redactSecrets } from '../../../shared/redact'
import { withoutCredentials } from '../../credentialEnvironment'

/** Tagged effects go through the harness's ordinary tool policy. Hooks receive
 * their real arguments/stdin, never an altered script or a substitute command. */
export interface PlaybookHookEffect {
  readonly kind: 'git' | 'hook'
  readonly cwd: string
  readonly command: string
  readonly args: readonly string[]
}
export interface PlaybookHookAdmission {
  admit(effect: PlaybookHookEffect): boolean
  /** Windows: the harness's preprepared job/tree registry executes the
   * original effect with these options and returns only after its entire
   * tree is ended. Missing containment refuses before hook dispatch. */
  readonly runContained?: (
    effect: PlaybookHookEffect,
    options: SpawnSyncOptions,
  ) => SpawnSyncReturns<Buffer>
}
type Work = Extract<PlaybookRecord, { kind: 'work' }>['value']
type Receipt = Extract<PlaybookRecord, { kind: 'verification' }>['value']

/** Synchronous state transition: missing receipts never emit push/done. The
 * owner publishes every returned record with journal CAS before admission. */
export function hasOutcomeReceipts(
  commits: readonly string[],
  digest: string,
  records: readonly PlaybookRecord[],
  scope: Receipt['scope'] = 'commit',
): boolean {
  return commits.every((commit) =>
    records.some(
      (record) =>
        record.kind === 'verification' &&
        record.value.scope === scope &&
        record.value.commit === commit &&
        record.value.hookDigest === digest &&
        record.value.result === 'pass',
    ),
  )
}

export function hookVerificationDigest(base: string, range?: PlaybookPushRange): string {
  return range
    ? createHash('sha256').update(base).update(JSON.stringify(range)).digest('hex')
    : base
}

export class PlaybookOutcomes {
  private hookFolder: string | undefined
  private hasConfiguredHooks = false
  constructor(
    private readonly workspace: string,
    private readonly admission: PlaybookHookAdmission,
  ) {}

  private bytes(effect: PlaybookHookEffect, isMissingAllowed = false): Buffer {
    if (!this.admission.admit(effect)) throw new Error(UI_TEXT.playbookUnavailable)
    const options = {
      cwd: effect.cwd,
      env: Object.fromEntries(
        Object.entries(withoutCredentials(process.env)).filter(
          ([name]) => !/^(?:GIT_.*|HUSKY|HUSKY_SKIP_HOOKS)$/iu.test(name),
        ),
      ),
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      windowsHide: true,
      detached: process.platform !== 'win32',
      killSignal: 'SIGKILL' as const,
    }
    // Ref/index plumbing can invoke repository hooks too. Every Windows
    // Git child needs the prepared registry job, including worktree cleanup.
    if (process.platform === 'win32' && !this.admission.runContained)
      throw new Error(UI_TEXT.playbookUnavailable)
    const result =
      process.platform === 'win32' && this.admission.runContained
        ? this.admission.runContained(effect, options)
        : spawnSync(effect.command, [...effect.args], options)
    // spawnSync has ended the leader on timeout; descendants still belong
    // to its detached POSIX group. Sweep it before cleanup on every exit,
    // including success with a background child. Never signal pid/group 0.
    if (process.platform !== 'win32' && result.pid > 0) {
      try {
        process.kill(-result.pid, 'SIGKILL')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
          throw new Error(UI_TEXT.playbookUnavailable, { cause: error })
      }
    }

    if (
      isMissingAllowed &&
      result.status === 1 &&
      result.stdout.length === 0 &&
      result.stderr.length === 0 &&
      !result.error
    )
      return Buffer.alloc(0)
    if (result.status !== 0 || result.error) {
      const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : ''
      const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : ''
      throw new Error(
        redactSecrets(
          `${UI_TEXT.playbookUnavailable}\n${result.error?.message ?? stdout + stderr}`,
        ),
      )
    }
    return effect.kind === 'hook' ? Buffer.concat([result.stdout, result.stderr]) : result.stdout
  }

  private run(effect: PlaybookHookEffect, isMissingAllowed = false): string {
    return this.bytes(effect, isMissingAllowed).toString('utf8')
  }

  private git(args: readonly string[], cwd = this.workspace): string {
    return this.run({ kind: 'git', cwd, command: 'git', args }).trimEnd()
  }

  reachable(refs: readonly string[]): string[] {
    if (refs.length === 0 || refs.some((ref) => !ref.startsWith('refs/') || /[\s\0]/u.test(ref)))
      throw new Error(UI_TEXT.playbookUnavailable)
    const tips = refs
      .map((ref) =>
        this.run(
          {
            kind: 'git',
            cwd: this.workspace,
            command: 'git',
            args: ['rev-parse', '--verify', '--quiet', ref],
          },
          true,
        ).trimEnd(),
      )
      .filter(Boolean)
    return tips.length > 0
      ? this.git(['rev-list', ...tips, '--'])
          .split('\n')
          .filter(Boolean)
      : []
  }

  snapshot(): string[] {
    // for-each-ref includes branches, tags and notes; worktree HEADs also
    // cover detached commits that have no named ref in the common repository.
    const refs = this.git(['for-each-ref', '--format=%(objectname)']).split('\n').filter(Boolean)
    const heads = this.git(['worktree', 'list', '--porcelain'])
      .split('\n')
      .filter((line) => line.startsWith('HEAD '))
      .map((line) => line.slice('HEAD '.length))
      .filter((oid) => !/^0+$/u.test(oid))
    const tips = [...new Set([...refs, ...heads])]
    return tips.length > 0
      ? this.git(['rev-list', ...tips, '--'])
          .split('\n')
          .filter(Boolean)
      : []
  }

  pushAnchor(range: PlaybookPushRange): string | undefined {
    const update = range.updates.find((item) => !/^0+$/u.test(item.localOid))
    return update ? this.git(['rev-parse', '--verify', update.localOid + '^{commit}']) : undefined
  }

  commits(work: Work, range?: PlaybookPushRange, initialBaseline = work.baseline): string[] {
    const baseline = new Set(work.baseline)
    const commits = this.snapshot().filter((commit) => !baseline.has(commit))
    if (!range) return commits
    const tips = range.updates
      .filter((update) => !/^0+$/u.test(update.localOid))
      .map((update) => update.localOid)
    if (range.updates.length === 0) throw new Error(UI_TEXT.playbookUnavailable)
    if (tips.length === 0) return commits
    const initial = new Set(initialBaseline)
    const introduced = this.git(['rev-list', ...tips, '--'])
      .split('\n')
      .filter((commit) => commit && !initial.has(commit))
    return [...new Set([...commits, ...introduced])]
  }

  /** Bind receipts to the exact configured hook bytes and exact push range.
   * Symlinks cannot silently replace the configured hook set. */
  digest(range?: PlaybookPushRange): string {
    const hookDir = this.git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'])
    const config = this.run(
      {
        kind: 'git',
        cwd: this.workspace,
        command: 'git',
        args: ['config', '--get', 'core.hooksPath'],
      },
      true,
    ).trimEnd()
    this.hookFolder = hookDir
    this.hasConfiguredHooks =
      Boolean(config) ||
      (existsSync(hookDir) && readdirSync(hookDir).some((name) => !name.endsWith('.sample')))
    // Earlier receipts can attest to a skipped Husky body. An epoch change
    // rejects those receipts and their frozen work digest without erasing history.
    const hash = createHash('sha256')
      .update('playbook/source-hooks/v2')
      .update(config.replaceAll('\\', '/'))
    const visit = (entry: string): void => {
      if (!existsSync(entry)) return
      const stat = lstatSync(entry)
      if (stat.isSymbolicLink()) throw new Error(UI_TEXT.playbookUnavailable)
      hash.update(path.relative(hookDir, entry).replaceAll('\\', '/')).update(String(stat.mode))
      if (stat.isDirectory()) {
        const children = readdirSync(entry).toSorted((a, b) => a.localeCompare(b))
        for (const child of children) visit(path.join(entry, child))
      } else hash.update(readFileSync(entry))
    }
    visit(hookDir.replaceAll('\\', '/').endsWith('/.husky/_') ? path.dirname(hookDir) : hookDir)
    // Recheck startup at admission too, including reuse of cached receipts.
    if (hookDir.replaceAll('\\', '/').endsWith('/.husky/_')) {
      const home = process.env['HOME'] ?? process.env['USERPROFILE']
      const configHome =
        process.env['XDG_CONFIG_HOME'] ?? (home ? path.join(home, '.config') : undefined)
      if (configHome && existsSync(path.join(configHome, 'husky', 'init.sh')))
        throw new Error(UI_TEXT.playbookUnavailable)
    }
    // Relative hook wrappers (e.g. Husky) invoke tracked scripts from the tree.
    return hookVerificationDigest(hash.digest('hex'), range)
  }

  verify(
    work: Work,
    commit: string,
    digest: string,
    at: number,
    range?: PlaybookPushRange,
  ): {
    readonly receipt: Receipt
    readonly output: string
  } {
    const scope = range ? 'push' : 'commit'
    let output = ''
    let result: Receipt['result'] = 'fail'
    const directory = mkdtempSync(path.join(tmpdir(), 'muse-playbook-hooks-'))
    const isolated = path.join(directory, 'tree')
    let isAddAttempted = false
    let rootRef: string | undefined
    try {
      const object = this.bytes({
        kind: 'git',
        cwd: this.workspace,
        command: 'git',
        args: ['cat-file', 'commit', commit],
      })
      const separator = object.indexOf('\n\n')
      if (separator === -1) throw new Error(UI_TEXT.playbookUnavailable)
      const headers = object.subarray(0, separator).toString('utf8').split('\n')
      const parent = headers.find((line) => line.startsWith('parent '))?.slice('parent '.length)
      const tree = headers.find((line) => line.startsWith('tree '))?.slice('tree '.length)
      isAddAttempted = true
      this.git(['worktree', 'add', '--detach', isolated, commit])
      // Stage the commit's complete tree against its first parent, exactly the
      // state that pre-commit and staged scanners are defined to inspect.
      if (!range && parent) this.git(['update-ref', 'HEAD', parent], isolated)
      else if (!range) {
        rootRef = `refs/heads/muse-playbook-verification/${work.id}/${commit}`
        this.git(['symbolic-ref', 'HEAD', rootRef], isolated)
      }
      this.git(['read-tree', commit], isolated)
      const hooks = this.hookFolder
      if (!hooks || this.digest(range) !== digest) throw new Error(UI_TEXT.playbookUnavailable)
      const message = path.join(directory, 'message')
      writeFileSync(message, object.subarray(separator + 2))
      const originalMessage = readFileSync(message)
      for (const hook of PLAYBOOK_HOOK_NAMES) {
        if ((hook === 'pre-push') !== (range !== undefined)) continue
        const hookFile = path.join(hooks, hook)
        if (!existsSync(hookFile)) {
          if (this.hasConfiguredHooks) throw new Error(UI_TEXT.playbookUnavailable)
          continue
        }
        const stat = lstatSync(hookFile)
        if (
          !stat.isFile() ||
          (process.platform !== 'win32' && (stat.mode & PLAYBOOK_HOOK_EXECUTABLE_MASK) === 0)
        )
          throw new Error(UI_TEXT.playbookUnavailable)
        // A relocated known Husky wrapper can still skip a missing body.
        // Refuse unsupported layouts rather than hash arbitrary ancestors or
        // certify helpers outside the captured .husky directory.
        if (
          !hooks.replaceAll('\\', '/').endsWith('/.husky/_') &&
          readFileSync(hookFile, 'utf8').includes('$(dirname "$0")/h')
        )
          throw new Error(UI_TEXT.playbookUnavailable)
        // Husky's native wrapper exits successfully if its body is absent,
        // or if sourced user startup code sets HUSKY=0. Neither is evidence
        // that a hook ran. Refuse startup scripts rather than interpret shell.
        if (hooks.replaceAll('\\', '/').endsWith('/.husky/_')) {
          for (const file of [path.join(hooks, 'h'), path.join(path.dirname(hooks), hook)])
            if (!existsSync(file) || !lstatSync(file).isFile())
              throw new Error(UI_TEXT.playbookUnavailable)
        }
        const args: string[] = []
        if (hook === 'commit-msg') args.push(message)
        else if (hook === 'pre-push' && range) args.push(range.remote, range.url)
        const input =
          hook === 'pre-push' && range
            ? range.updates
                .map(
                  (update) =>
                    `${update.localRef} ${update.localOid} ${update.remoteRef} ${update.remoteOid}\n`,
                )
                .join('')
            : undefined
        const stdinFile = path.join(directory, 'push-range')
        if (input !== undefined) writeFileSync(stdinFile, input)
        output += this.run({
          kind: 'hook',
          cwd: isolated,
          command: 'git',
          args: [
            '-c',
            `core.hooksPath=${hooks}`,
            'hook',
            'run',
            ...(input === undefined ? [] : [`--to-stdin=${stdinFile}`]),
            hook,
            '--',
            ...args,
          ],
        })
      }
      const head = this.run(
        {
          kind: 'git',
          cwd: isolated,
          command: 'git',
          args: ['rev-parse', '--verify', '--quiet', 'HEAD'],
        },
        true,
      ).trimEnd()
      if (head !== (range ? commit : (parent ?? ''))) throw new Error(UI_TEXT.playbookUnavailable)
      if (
        this.git(['write-tree'], isolated) !== tree ||
        this.git(['diff', '--no-ext-diff', '--no-textconv', '--exit-code'], isolated) !== ''
      )
        throw new Error(UI_TEXT.playbookUnavailable)
      if (!readFileSync(message).equals(originalMessage) || this.digest(range) !== digest)
        throw new Error(UI_TEXT.playbookUnavailable)
      result = 'pass'
    } catch (error) {
      output += error instanceof Error ? redactSecrets(error.message) : UI_TEXT.playbookUnavailable
    } finally {
      // Git may register a worktree before post-checkout fails. Attempt Git
      // cleanup even when add did not return successfully; prune after rm.
      for (const args of [
        ...(rootRef ? [['update-ref', '-d', rootRef]] : []),
        ...(isAddAttempted ? [['worktree', 'remove', '--force', isolated]] : []),
      ]) {
        try {
          this.git(args)
        } catch (error) {
          result = 'fail'
          output +=
            error instanceof Error ? redactSecrets(error.message) : UI_TEXT.playbookUnavailable
        }
      }
      try {
        rmSync(directory, { recursive: true, force: true })
      } catch (error) {
        result = 'fail'
        output +=
          error instanceof Error ? redactSecrets(error.message) : UI_TEXT.playbookUnavailable
      }
      if (isAddAttempted) {
        try {
          this.git(['worktree', 'prune'])
        } catch (error) {
          result = 'fail'
          output +=
            error instanceof Error ? redactSecrets(error.message) : UI_TEXT.playbookUnavailable
        }
      }
    }

    return {
      receipt: {
        workId: work.id,
        moduleId: work.moduleId,
        commit,
        hookDigest: digest,
        scope,
        result,
        at,
      },
      output: redactSecrets(output),
    }
  }
}
