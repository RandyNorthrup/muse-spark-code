// Native writes for the session-owned shell report. Context builders have no
// filesystem import; these operations never read model context.
import { mkdir, rm } from 'node:fs/promises'

export async function prepareShellSidecar(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
}

export async function removeShellSidecar(file: string): Promise<void> {
  await rm(file, { force: true })
}
