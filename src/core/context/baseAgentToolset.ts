// B0: first-boot preparation shared by node/native/editor hosts. The boot owner
// injects M81's verified store and its actual download-consent surface. This
// module never installs a CLI, opens a port, launches Chrome or reads sign-in.
import type {
  BrowserRuntimeBundle,
  RuntimePreparation,
  RuntimePrepareRequest,
} from '../browser/runtimeTypes'
import {
  installBundledSkills,
  type BundledSkillsInstallDeps,
  type BundledSkillsInstallResult,
} from '../skills/bundledSkillsInstall'
import { bundledSkillsPackageRoot, firstPartySkillsRoot, type BundledSkillsSource } from './skills'

interface BaseAgentToolsetDeps {
  readonly packageRoot: string
  readonly platform: NodeJS.Platform
  readonly bundledSkillsEnabled?: () => boolean
  readonly browserRuntimeEnabled?: () => boolean
  /** Undefined for a setup without Muse Code; N must first qualify H17/H18. */
  readonly museSkills: BundledSkillsInstallDeps | undefined
  readonly browserRequest: RuntimePrepareRequest
  /** M81's existing lazy browserRuntime bundle; no alternate downloader. */
  readonly prepareRuntime: BrowserRuntimeBundle['prepareRuntime']
}

/** Data only: boot/help surfaces word the existing failures in the installed language. */
interface BaseAgentToolsetPreparation {
  readonly skills: BundledSkillsInstallResult | { readonly kind: 'disabled' | 'notRequested' }
  readonly browser: RuntimePreparation | { readonly kind: 'disabled' }
}

/** Default-on source and explicit first-boot work; no module-load setting reads. */
export function createBaseAgentToolset(deps: BaseAgentToolsetDeps): {
  readonly bundledSkills: BundledSkillsSource
  prepare(): Promise<BaseAgentToolsetPreparation>
} {
  const isEnabled = () => deps.bundledSkillsEnabled?.() ?? true
  return {
    bundledSkills: {
      packageRoot: bundledSkillsPackageRoot(deps.packageRoot, deps.platform),
      firstPartyRoot: firstPartySkillsRoot(deps.packageRoot, deps.platform),
      isEnabled,
    },
    async prepare() {
      let skills: BaseAgentToolsetPreparation['skills'] = { kind: 'disabled' }
      if (isEnabled()) {
        skills =
          deps.museSkills === undefined
            ? { kind: 'notRequested' }
            : await installBundledSkills(deps.museSkills)
      }
      const browser =
        (deps.browserRuntimeEnabled?.() ?? true)
          ? await deps.prepareRuntime(deps.browserRequest)
          : { kind: 'disabled' as const }
      return { skills, browser }
    },
  }
}
