// One shape for bundled child entries' plan files: read the argv path,
// parse its JSON, and prove it with the entry's own guard.
import { readFile } from 'node:fs/promises'

export async function readChildPlan<Plan>(
  argument: string | undefined,
  isPlan: (value: unknown) => value is Plan,
  label: string,
): Promise<Plan> {
  if (argument === undefined) throw new Error('plan file argument missing')
  const parsed: unknown = JSON.parse(await readFile(argument, 'utf8'))
  if (!isPlan(parsed)) throw new Error(`plan file is not a ${label} plan`)
  return parsed
}
