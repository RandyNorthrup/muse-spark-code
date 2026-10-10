// The one native layout for every test that runs scripts/package-acp.mjs over
// a test-owned source tree (usagePackaging, runtimeChatGptPackage, execStdio's
// package guards). It reads the packager's own list
// (scripts/lib/acpNativeSources.mjs) and copies that module beside the
// fixture's packager, so a file the package starts to require reaches every
// fixture at once (CIFIX017R3). acpPackageFixtures.test.ts holds each
// packaging fixture to it.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  DARWIN_HELPER,
  JOB_SOURCES,
  LINUX_HELPERS,
  RUNNER_HELPERS,
} from '../../../scripts/lib/acpNativeSources.mjs'

const SOURCES_MODULE = path.join('scripts', 'lib', 'acpNativeSources.mjs')

/** Every native file the packager copies one by one. */
export const ACP_NATIVE_FILES: readonly string[] = [...JOB_SOURCES, DARWIN_HELPER, ...LINUX_HELPERS]

/**
 * Lays out the packager's native inputs under `root`: inert test-owned bytes
 * for each file (packaging never executes them), the repository's runner
 * helpers, and the list module the copied packager imports.
 */
export function layOutAcpNativeSources(root: string, repository: string): void {
  for (const file of ACP_NATIVE_FILES) {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, 'test-owned inert native fixture\n')
  }
  cpSync(path.join(repository, RUNNER_HELPERS), path.join(root, RUNNER_HELPERS), {
    recursive: true,
  })
  mkdirSync(path.join(root, path.dirname(SOURCES_MODULE)), { recursive: true })
  cpSync(path.join(repository, SOURCES_MODULE), path.join(root, SOURCES_MODULE))
}
