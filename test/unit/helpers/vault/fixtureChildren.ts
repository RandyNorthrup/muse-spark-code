import { execFileSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { expect } from 'vitest'
import { vaultPeerExecutable } from '../../../../src/runtime/vault/posixNative'

/** Compile the real POSIX peer helper into the fixture install. */
export async function compileVaultPeer(root: string): Promise<void> {
  const helper = vaultPeerExecutable(root)
  await mkdir(path.dirname(helper), { recursive: true })
  execFileSync('/usr/bin/cc', [
    '-Os',
    '-Wall',
    '-Wextra',
    '-Werror',
    'native/posix/vaultPeer.c',
    '-o',
    helper,
  ])
}

/** Bundle one fixture child with the generated admission binding. */
export async function bundleFixtureChild(
  entry: string,
  outfile: string,
  options: { readonly external?: readonly string[]; readonly define?: Record<string, string> } = {},
): Promise<void> {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    ...(options.external !== undefined && { external: [...options.external] }),
    ...(options.define !== undefined && { define: options.define }),
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'generated-admission',
        setup(builder) {
          builder.onResolve({ filter: /admission(?:\.js)?$/ }, () => ({
            path: path.resolve('test/unit/helpers/vault/sessionAdmission.ts'),
          }))
        },
      },
    ],
  })
}

/** Register one fixture child and capture its diagnostic stream. */
export function trackFixtureChild(children: Set<ChildProcess>, child: ChildProcess): Buffer[] {
  children.add(child)
  if (child.stdout === null || child.stderr === null)
    throw new Error('missing fixture diagnostic pipes')
  child.stdout.resume()
  const errors: Buffer[] = []
  child.stderr.on('data', (bytes: Buffer) => {
    errors.push(bytes)
  })
  return errors
}

/**
 * Race one fixture child's readiness message against its early exit: a
 * child that dies while building fails fast with its diagnostics, never
 * hanging to the test timeout.
 */
export async function awaitFixtureMessage(
  child: ChildProcess,
  errors: Buffer[],
): Promise<{ message: unknown[] } | { diagnostics: string }> {
  const raced = await Promise.race([
    (async () => ({ kind: 'message', message: await once(child, 'message') }) as const)(),
    (async () => {
      await once(child, 'exit')
      return {
        kind: 'exited',
        diagnostics: Buffer.concat(errors).toString('utf8'),
      } as const
    })(),
  ])
  return raced.kind === 'message' ? { message: raced.message } : { diagnostics: raced.diagnostics }
}

/** Stop one fixture child and require the clean exit the fixtures promise. */
export async function shutdownFixtureChild(
  children: Set<ChildProcess>,
  child: ChildProcess,
): Promise<void> {
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const [code] = await exited
  children.delete(child)
  expect(code).toBe(0)
}

/** Kill every remaining fixture child and remove the fixture root. */
export async function sweepFixtureChildren(
  children: Set<ChildProcess>,
  root: string,
): Promise<void> {
  for (const child of children) {
    child.kill('SIGKILL')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  }
  if (!root) return
  await rm(root, { recursive: true, force: true })
}
