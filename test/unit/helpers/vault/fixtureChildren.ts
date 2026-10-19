import { type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

/**
 * Bundle one fixture child: the child bundles the production admission
 * module, so each proof runs the same admission the installed broker does.
 */
export async function bundleFixtureChild(entry: string, outfile: string): Promise<void> {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
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
