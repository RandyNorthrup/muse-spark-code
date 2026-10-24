// Vitest global setup (M100 join, the Windows harness budget): builds the
// production bundles once per test run, before any test file starts and
// outside every hook's deadline, when the run includes a suite that serves
// them from dist/. Those suites check for this shared build in their
// preparation instead of rebuilding, so their named preparation budget covers
// only their own server and browser, and two suites never write dist/ at once.
// Vitest keeps a global setup for a whole watch session, so every rerun that
// selects such a suite builds again, and the proof each suite checks is the
// generation of the build inputs it was built from (RVM100J2 1).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** The suites that serve the production build from dist/. */
// Its own key: globalSetup.mjs provides PRODUCTION_BUILD_KEY, the copied
// build's folder, to the suites that stage one (the devices harness among
// them); this proof is only the generation of the root's dist/.
const PRODUCTION_BUILD_SUITES: ReadonlySet<string> = new Set([
  'test/unit/teamHarness.test.mjs',
  // M98 phase 2 (RVM98P2R2 10): the delivery suite verifies dist/ itself.
  'test/unit/judgeP2Delivery.test.ts',
  // RLM98P2: the shipped-assembly suite serves dist/judgeP2.js itself.
  'test/unit/judgeWiringAssembly.test.ts',
  // RLM98P2: the SystemOne side suite serves the shipped bundle itself.
  'test/unit/judgeP2RedesignSides.test.ts',
  // M104 lane H: the language server and supervision run from dist/acp.js.
  'test/unit/runtimeLsp.test.ts',
  // M104 lane B: the runtime panel runs from dist/acp.js and dist/runtimePanel.js.
  'test/unit/runtimePanel.test.ts',
  // M104 lane B: the chat in the runtime panel runs the conversation controller from dist/acp.js.
  'test/unit/runtimePanelConversation.test.ts',
  // M104 lane B: conversations in the runtime panel load the controller and the session bundle from dist/.
  'test/unit/runtimePanelSessions.test.ts',
  // M104 lane B: the bundles the runtime panel loads run without the vscode module.
  'test/unit/runtimePortableBundles.test.ts',
])
// A hung build fails the run with its output instead of holding it open.
const PRODUCTION_BUILD_TIMEOUT_MS = 600_000
// What scripts/build.mjs reads: these tracked folders and root files.
const BUILD_INPUT_FOLDERS: ReadonlySet<string> = new Set([
  'src',
  'scripts',
  'l10n',
  'vendor',
  'native',
  'media',
  'resources',
  'skills',
  'first-party-skills',
])
const BUILD_INPUT_FILE =
  /^(?:package(?:\.nls(?:\.[\w-]+)?)?\.json|package-lock\.json|tsconfig(?:\.\w+)?\.json|THIRD_PARTY_NOTICES\.txt)$/u
// The tracked-file listing of a large repository.
const GIT_LIST_MAX_BYTES = 64 * 1024 * 1024

declare module 'vitest' {
  export interface ProvidedContext {
    /** The build inputs' generation this run built from; empty when it built nothing. */
    productionBuildGeneration: string
  }
}

/** Whether any selected test file serves the production build. */
export function requiresProductionBuild(root: string, selected: readonly string[]): boolean {
  return selected.some((file) =>
    PRODUCTION_BUILD_SUITES.has(path.relative(root, file).replaceAll('\\', '/')),
  )
}

/** The tracked build inputs, repository-relative. */
function buildInputs(root: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: GIT_LIST_MAX_BYTES,
  })
    .split('\0')
    .filter(
      (file) =>
        file !== '' &&
        (BUILD_INPUT_FOLDERS.has(file.split('/', 1)[0] ?? '') || BUILD_INPUT_FILE.test(file)),
    )
}

/** One hash over every build input's path and bytes: any source edit is a new generation. */
export function buildGeneration(
  root: string,
  files: readonly string[] = buildInputs(root),
): string {
  const hash = createHash('sha256')
  // Byte order, independent of locale.
  const ordered = files.toSorted((left, right) => (left < right ? -1 : Number(left > right)))
  for (const file of ordered) {
    hash.update(file).update('\0')
    try {
      hash.update(readFileSync(path.join(root, file)))
    } catch {
      hash.update('missing')
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** Refuses a run with no shared build, or one built from sources since changed. */
export function assertCurrentProductionBuild(
  built: string,
  root: string,
  files?: readonly string[],
): void {
  if (built === '') throw new Error('No shared production build in this run')
  if (built !== buildGeneration(root, files))
    throw new Error('Stale shared production build: its sources changed after this run built it')
}

/** The part of Vitest's test project this setup uses. */
interface SetupProject {
  readonly config: { readonly root: string }
  readonly vitest: { readonly state: { getPaths(): string[] } }
  provide(key: 'productionBuildGeneration', value: string): void
  onTestsRerun(listener: (specifications: readonly { readonly moduleId: string }[]) => void): void
}
interface BuildPorts {
  build(root: string): void
  generation(root: string): string
}
const realBuild: BuildPorts = {
  build: (root) => {
    execFileSync(process.execPath, ['scripts/build.mjs', '--production'], {
      cwd: root,
      stdio: 'pipe',
      timeout: PRODUCTION_BUILD_TIMEOUT_MS,
    })
  },
  generation: (root) => buildGeneration(root),
}

/** The global setup over its build ports (the real build by default). */
export function productionBuildSetup(ports: BuildPorts = realBuild) {
  return (project: SetupProject): void => {
    const root = project.config.root
    const prepare = (selected: readonly string[]) => {
      if (!requiresProductionBuild(root, selected)) {
        project.provide('productionBuildGeneration', '')
        return
      }
      ports.build(root)
      project.provide('productionBuildGeneration', ports.generation(root))
    }
    // The run's selected files (the state API is experimental: a change there
    // shows as the serving suites' own refusal, never a silent skip).
    prepare(project.vitest.state.getPaths())
    project.onTestsRerun((specifications) => {
      prepare(specifications.map((specification) => specification.moduleId))
    })
  }
}

// The Vitest global setup entry: a declaration, so no module runs work on
// import (unicorn/no-top-level-side-effects); the build still runs once per
// selected run inside setup, outside every hook's deadline.
export default function setup(project: SetupProject): void {
  productionBuildSetup()(project)
}
