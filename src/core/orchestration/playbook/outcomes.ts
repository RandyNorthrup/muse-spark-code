import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
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
  constructor(
    private readonly workspace: string,
    private readonly admission: PlaybookHookAdmission,
  ) {}

  private bytes(effect: PlaybookHookEffect, isMissingAllowed = false): Buffer {
    if (!this.admission.admit(effect)) throw new Error(UI_TEXT.playbookUnavailable)
    const result = spawnSync(effect.command, [...effect.args], {
      cwd: effect.cwd,
      env: withoutCredentials(process.env),
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      windowsHide: true,
    })
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
    const head = this.run(
      {
        kind: 'git',
        cwd: this.workspace,
        command: 'git',
        args: ['rev-parse', '--verify', '--quiet', 'HEAD'],
      },
      true,
    ).trimEnd()
    return this.git(['rev-list', '--all', ...(head ? [head] : [])])
      .split('\n')
      .filter(Boolean)
  }

  commits(work: Work, range?: PlaybookPushRange, initialBaseline = work.baseline): string[] {
    const baseline = new Set(work.baseline)
    const commits = this.reachable(work.refs).filter((commit) => !baseline.has(commit))
    if (!range) return commits
    const tips = range.updates.map((update) => update.localOid)
    if (tips.length === 0) throw new Error(UI_TEXT.playbookUnavailable)
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
    const hash = createHash('sha256').update(config.replaceAll('\\', '/'))
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
    let isAdded = false
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
      this.git(['worktree', 'add', '--detach', isolated, commit])
      isAdded = true
      // Stage the commit's complete tree against its first parent, exactly the
      // state that pre-commit and staged scanners are defined to inspect.
      if (!range && parent) this.git(['update-ref', 'HEAD', parent], isolated)
      else if (!range) {
        rootRef = `refs/heads/muse-playbook-verification/${work.id}/${commit}`
        this.git(['symbolic-ref', 'HEAD', rootRef], isolated)
      }
      this.git(['read-tree', commit], isolated)
      const hooks = this.git(
        ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'],
        isolated,
      )
      const sourceHooks = this.hookFolder
      if (!sourceHooks) throw new Error(UI_TEXT.playbookUnavailable)
      if (
        hooks.replaceAll('\\', '/') !== sourceHooks.replaceAll('\\', '/') &&
        existsSync(sourceHooks) &&
        !existsSync(hooks)
      )
        cpSync(sourceHooks, hooks, {
          recursive: true,
          dereference: false,
          preserveTimestamps: true,
        })
      if (new PlaybookOutcomes(isolated, this.admission).digest(range) !== digest)
        throw new Error(UI_TEXT.playbookUnavailable)
      const message = path.join(directory, 'message')
      writeFileSync(message, object.subarray(separator + 2))
      const originalMessage = readFileSync(message)
      for (const hook of PLAYBOOK_HOOK_NAMES) {
        if ((hook === 'pre-push') !== (range !== undefined)) continue
        const hookFile = path.join(hooks, hook)
        if (!existsSync(hookFile)) continue // Git defines an absent hook as no hook.
        const stat = lstatSync(hookFile)
        if (
          !stat.isFile() ||
          (process.platform !== 'win32' && (stat.mode & PLAYBOOK_HOOK_EXECUTABLE_MASK) === 0)
        )
          throw new Error(UI_TEXT.playbookUnavailable)
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
      if (
        !readFileSync(message).equals(originalMessage) ||
        new PlaybookOutcomes(isolated, this.admission).digest(range) !== digest ||
        this.digest(range) !== digest
      )
        throw new Error(UI_TEXT.playbookUnavailable)
      result = 'pass'
    } catch (error) {
      output += error instanceof Error ? redactSecrets(error.message) : UI_TEXT.playbookUnavailable
    } finally {
      try {
        if (rootRef) this.git(['update-ref', '-d', rootRef])
        if (isAdded) this.git(['worktree', 'remove', '--force', isolated])
      } catch (error) {
        result = 'fail'
        output +=
          error instanceof Error ? redactSecrets(error.message) : UI_TEXT.playbookUnavailable
      }
      rmSync(directory, { recursive: true, force: true })
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
