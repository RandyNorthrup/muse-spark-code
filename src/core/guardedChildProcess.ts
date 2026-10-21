// Every process src/ starts goes through here, `runProgram`, `runTreeSync`
// or the governed launch: the child's environment is always a
// `GuardedChildEnv` only `workspaceChildEnvironment` /
// `noWorkspaceChildEnvironment` can produce, so passing a raw `process.env`
// (or serializing one for a native helper) is a type error the compiler
// lists. Boundary helpers that take a raw environment (`execResourceFile`,
// `handoffResourceFile`, the git runners) guard it internally before
// reaching these starters.
import {
  execFile as nodeExecFile,
  spawn as nodeSpawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type ExecFileException,
  type ExecFileOptions,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process'
import type { GuardedChildEnv } from './executables'

/** `spawn` options with the guarded child environment, nothing else changed. */
export type GuardedSpawnOptions = Omit<SpawnOptions, 'env'> & {
  readonly env: GuardedChildEnv
}

/**
Starts `file` with the guarded child environment for its working
directory: a bare name still resolves, but never to a program planted in
the workspace, and nothing it starts by bare name does either. The
overloads mirror `spawn`'s own: an all-pipe stdio array keeps the
non-null pipes.
*/
export function spawnGuarded(
  file: string,
  args: readonly string[],
  options: Omit<SpawnOptionsWithoutStdio, 'env'> & { readonly env: GuardedChildEnv },
): ChildProcessWithoutNullStreams
export function spawnGuarded(
  file: string,
  args: readonly string[],
  options: GuardedSpawnOptions,
): ChildProcess
export function spawnGuarded(
  file: string,
  args: readonly string[],
  options: GuardedSpawnOptions,
): ChildProcess {
  return nodeSpawn(file, [...args], options)
}

/**
`execFile` options with the guarded child environment. Only string
encodings: every call site reads text, so a buffer encoding does not
type-check here.
*/
export type GuardedExecFileOptions = Omit<ExecFileOptions, 'env' | 'encoding'> & {
  readonly env: GuardedChildEnv
  readonly encoding?: BufferEncoding | undefined
}

/** `execFile` as the guarded call sites call it: text stdout and stderr. */
export type GuardedExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void

/**
Runs `file` to its end with the guarded child environment for its cwd.
Like `execFile`, the callback may be omitted for a fire-and-forget start
whose errors surface on the child.
*/
export function execFileGuarded(
  file: string,
  args: readonly string[],
  options: GuardedExecFileOptions,
  callback?: GuardedExecFileCallback,
): ChildProcess {
  return callback === undefined
    ? nodeExecFile(file, [...args], { ...options, env: options.env })
    : nodeExecFile(file, [...args], { ...options, env: options.env }, callback)
}
