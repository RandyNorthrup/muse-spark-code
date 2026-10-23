// M125 lane F2 (D107 §9.5): the owner's baseline — the version at
// the last HEAD that moved while no agent turn was running. One
// store per workspace; each check keys its own baseline, since
// checks establish on different turns. Git reads arrive through
// ports the harness implements against the object store with no
// filter, hook or text conversion; this module attributes moves,
// establishes baselines and compares closures, and names the reason
// in typed protocol words, never display text. Linux only.
import { Buffer } from 'node:buffer'
import type { B2DefinitionClosure } from './b2Closure'

/** The git reads the baseline needs, answered from the object store. */
export interface B2GitReads {
  /** The current HEAD sha, or nothing without a repository or HEAD. */
  readonly readHead: (repoRoot: string) => Promise<string | undefined>
  /** The blob's raw bytes at the revision, or nothing when absent. */
  readonly readBlob: (
    repoRoot: string,
    rev: string,
    path: string,
  ) => Promise<Uint8Array | undefined>
  /** Workspace-relative paths with uncommitted change, or nothing. */
  readonly uncommittedPaths: (repoRoot: string) => Promise<readonly string[] | undefined>
}

/** The check a baseline belongs to: its manager and script. */
export function b2CheckKey(manager: string, script: string): string {
  return `${manager}:${script}`
}

/**
One workspace's baselines. A HEAD that moves during a turn is the
agent's and never becomes a baseline; a HEAD that moves between
turns is the owner's and advances every established check. On first
use a check establishes at the HEAD starting the first turn in
which its closure has no uncommitted change.
*/
export class B2Baselines {
  private readonly shas = new Map<string, string>()

  /** The check's baseline sha, or nothing before it establishes. */
  get(checkKey: string): string | undefined {
    return this.shas.get(checkKey)
  }

  /**
  The check's first use at its turn's starting HEAD: establishes when
  the head exists and the closure is clean there, keeps an established
  baseline, and otherwise names why not.
  */
  establish(
    checkKey: string,
    head: string | undefined,
    isClosureClean: boolean,
  ): 'established' | 'present' | 'dirty' | 'noHead' {
    if (this.shas.has(checkKey)) return 'present'
    if (head === undefined) return 'noHead'
    if (!isClosureClean) return 'dirty'
    this.shas.set(checkKey, head)
    return 'established'
  }

  /** A HEAD move lands: the owner's advances every baseline, the agent's none. */
  noteHeadMove(head: string | undefined, isTurnRunning: boolean): void {
    if (isTurnRunning || head === undefined) return
    for (const key of this.shas.keys()) {
      this.shas.set(key, head)
    }
  }
}

export type B2CompareVerdict =
  { readonly equal: true } | { readonly equal: false; readonly at: string }

/**
Whether the closure is byte-identical to the owner's baseline: the
same reached scripts with the same texts, fields, configuration
bytes and pinned files. The first difference names its path.
*/
export function compareB2Closures(
  current: B2DefinitionClosure,
  baseline: B2DefinitionClosure,
): B2CompareVerdict {
  const currentNames = new Set(current.scripts.map((script) => script.name))
  const baselineNames = new Set(baseline.scripts.map((script) => script.name))
  for (const name of currentNames) {
    if (!baselineNames.has(name)) return { equal: false, at: `script ${name}` }
  }
  for (const name of baselineNames) {
    if (!currentNames.has(name)) return { equal: false, at: `script ${name}` }
  }
  const baselineTexts = new Map(baseline.scripts.map((script) => [script.name, script.text]))
  for (const script of current.scripts) {
    if (baselineTexts.get(script.name) !== script.text) {
      return { equal: false, at: `script ${script.name}` }
    }
  }
  const currentFields = Object.keys(current.fields)
  const baselineFields = Object.keys(baseline.fields)
  if (
    currentFields.length !== baselineFields.length ||
    currentFields.some((field) => current.fields[field] !== baseline.fields[field])
  ) {
    return { equal: false, at: 'package.json fields' }
  }
  const configs = (closure: B2DefinitionClosure): Map<string, string> =>
    new Map(
      closure.configs.map((config) => [config.source, Buffer.from(config.bytes).toString('hex')]),
    )
  const currentConfigs = configs(current)
  const baselineConfigs = configs(baseline)
  for (const source of currentConfigs.keys()) {
    if (currentConfigs.get(source) !== baselineConfigs.get(source)) {
      return { equal: false, at: `config ${source}` }
    }
  }
  for (const source of baselineConfigs.keys()) {
    if (!currentConfigs.has(source)) return { equal: false, at: `config ${source}` }
  }
  const files = (closure: B2DefinitionClosure): Map<string, string> =>
    new Map(
      closure.files.map((file) =>
        file.kind === 'file'
          ? [file.path, `file:${Buffer.from(file.bytes).toString('hex')}`]
          : [file.path, `link:${file.target}`],
      ),
    )
  const currentFiles = files(current)
  const baselineFiles = files(baseline)
  for (const [path, body] of currentFiles) {
    if (baselineFiles.get(path) !== body) return { equal: false, at: path }
  }
  for (const path of baselineFiles.keys()) {
    if (!currentFiles.has(path)) return { equal: false, at: path }
  }
  return { equal: true }
}

/**
Whether the closure is clean at the revision: none of its snapshot
paths — the manifest, the configurations and the pinned files —
differs from HEAD uncommitted. The harness lists the uncommitted
paths; this module matches them against the closure.
*/
export function isClosureClean(
  closurePaths: readonly string[],
  uncommitted: readonly string[] | undefined,
): boolean {
  if (uncommitted === undefined) return false
  const dirty = new Set(uncommitted.map((path) => path.replaceAll('\\', '/')))
  return closurePaths.every((path) => !dirty.has(path.replaceAll('\\', '/')))
}
