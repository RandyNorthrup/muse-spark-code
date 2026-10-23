// D90.27's editor lane (M110t TV): per-OS install plans with the same
// pins the packs carry. Each tool becomes install steps (winget,
// Homebrew or apt) and a version-check step; each managed install
// becomes its ecosystem's exact-pinned command (`go install`, `cargo
// install --locked`, `npm -g`, `uv tool`, `uv python`, `Install-Module`,
// `rustup toolchain`). Pin policy: winget carries the exact pin and
// fails visibly when the repository lacks it; Homebrew and apt install
// what they carry and the version check reports actual against want —
// except Node majors and Temurin majors, whose verified versioned
// formulae/casks install side by side. Managed installs carry exact
// pins on every OS (Python rides `uv python install`); uv on apt
// bootstraps from the distro Python. Anything no manager carries is
// blocked with its reason,
// never skipped: the panel shows it, the person installs it by hand
// and re-runs, and its check still runs. Steps run only on the
// person's click in a visible terminal (the panel's); no step
// auto-accepts prompts or agreements. Pure: the panel maps pack
// definitions onto the inputs and runs the plan.

/** One manager-installed tool with the check that proves its version. */
export interface GuidedTool {
  readonly tool: string
  readonly version: string
  readonly check: readonly string[]
}

export type GuidedManagedKind =
  'go' | 'cargo' | 'npm' | 'uvTools' | 'uvPythons' | 'psGallery' | 'rust'

/** One ecosystem install with the check that proves its version. */
export interface GuidedManaged {
  readonly kind: GuidedManagedKind
  readonly id: string
  readonly version: string
  readonly check: readonly string[]
}

export type GuidedStep =
  | { readonly kind: 'install'; readonly argv: readonly string[] }
  | { readonly kind: 'check'; readonly argv: readonly string[]; readonly want: string }

/** A tool no manager carries on this OS: the person installs it by hand. */
export interface GuidedBlocked {
  readonly tool: string
  readonly version: string
  readonly code: 'manual-install'
}

export interface GuidedPlan {
  readonly steps: readonly GuidedStep[]
  readonly blocked: readonly GuidedBlocked[]
}

/**
Each tool's manager package per OS, verified 2026-10-22 (winget-pkgs
contents API, formulae.brew.sh formula/cask APIs, apt-cache on Ubuntu;
absent means refused). Brew casks install with `brew install --cask`;
`link` follows a keg-only versioned formula so the tools land on PATH.
*/
interface OsPackage {
  readonly winget?: string
  readonly brew?: string
  readonly brewCask?: boolean
  readonly brewLink?: boolean
  readonly apt?: readonly string[]
}

const OS_PACKAGES: Readonly<Record<string, OsPackage>> = {
  node: { winget: 'OpenJS.NodeJS', brew: 'node', apt: ['nodejs'] },
  'node-22': { winget: 'OpenJS.NodeJS', brew: 'node@22', brewLink: true, apt: ['nodejs'] },
  'node-24': { winget: 'OpenJS.NodeJS', brew: 'node@24', brewLink: true, apt: ['nodejs'] },
  go: { winget: 'GoLang.Go', brew: 'go', apt: ['golang'] },
  rustup: { winget: 'Rustlang.Rustup', brew: 'rustup' },
  uv: { winget: 'astral-sh.uv', brew: 'uv' },
  'dotnet-sdk': { brew: 'dotnet' },
  temurin: { brew: 'temurin', brewCask: true },
  pwsh: { winget: 'Microsoft.PowerShell', brew: 'powershell' },
  cmake: { winget: 'Kitware.CMake', brew: 'cmake', apt: ['cmake'] },
  ninja: { winget: 'Ninja-build.Ninja', brew: 'ninja', apt: ['ninja-build'] },
  kubectl: { winget: 'Kubernetes.kubectl', brew: 'kubernetes-cli' },
  helm: { winget: 'Helm.Helm', brew: 'helm' },
  shellcheck: { winget: 'koalaman.shellcheck', brew: 'shellcheck', apt: ['shellcheck'] },
  shfmt: { winget: 'mvdan.shfmt', brew: 'shfmt', apt: ['shfmt'] },
  vale: { brew: 'vale' },
  lychee: { winget: 'lycheeverse.lychee', brew: 'lychee' },
  actionlint: { winget: 'rhysd.actionlint', brew: 'actionlint' },
  gitleaks: { brew: 'gitleaks', apt: ['gitleaks'] },
  'osv-scanner': { brew: 'osv-scanner' },
  zizmor: { brew: 'zizmor' },
  hadolint: { brew: 'hadolint' },
  bats: { brew: 'bats-core', apt: ['bats'] },
  gradle: { brew: 'gradle', apt: ['gradle'] },
  maven: { brew: 'maven', apt: ['maven'] },
  godot: { brew: 'godot', brewCask: true },
  'arduino-cli': { brew: 'arduino-cli' },
  'podman-remote': { winget: 'RedHat.Podman', brew: 'podman', apt: ['podman-remote'] },
  opentofu: { brew: 'opentofu' },
  llvm: { brew: 'llvm', apt: ['llvm'] },
  cppcheck: { brew: 'cppcheck', apt: ['cppcheck'] },
  gcc: { brew: 'gcc', apt: ['gcc', 'g++'] },
  valgrind: { brew: 'valgrind', apt: ['valgrind'] },
  qemu: { brew: 'qemu', apt: ['qemu-system-arm', 'qemu-system-misc'] },
  picotool: { brew: 'picotool' },
}

/** Winget IDs that embed the major, verified per major (winget-pkgs API). */
const WINGET_MAJOR_IDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'dotnet-sdk': {
    '8': 'Microsoft.DotNet.SDK.8',
    '9': 'Microsoft.DotNet.SDK.9',
    '10': 'Microsoft.DotNet.SDK.10',
  },
  temurin: {
    '17': 'EclipseAdoptium.Temurin.17.JDK',
    '21': 'EclipseAdoptium.Temurin.21.JDK',
    '25': 'EclipseAdoptium.Temurin.25.JDK',
  },
}

/** Brew casks that embed the major, verified per major (cask API). */
const BREW_MAJOR_CASKS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  temurin: { '17': 'temurin@17', '21': 'temurin@21', '25': 'temurin@25' },
  'dotnet-sdk': { '9': 'dotnet-sdk@9' },
}

function majorOf(version: string): string | undefined {
  const major = version.split('.', 1)[0]
  return major !== undefined && /^[0-9]+$/.test(major) ? major : undefined
}

function majorId(
  table: Readonly<Record<string, Readonly<Record<string, string>>>>,
  tool: string,
  version: string,
): string | undefined {
  const major = majorOf(version)
  const row = table[tool]
  return major === undefined || row === undefined ? undefined : row[major]
}

function wingetInstall(id: string, version: string): readonly string[] {
  return ['winget', 'install', '--id', id, '--version', version, '--exact']
}

function brewInstall(formula: string, isCask: boolean): readonly string[] {
  return isCask ? ['brew', 'install', '--cask', formula] : ['brew', 'install', formula]
}

function aptInstall(packages: readonly string[]): readonly string[] {
  return ['sudo', 'apt', 'install', ...packages]
}

function stripV(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version
}

/** Each ecosystem's exact-pinned install; psGallery rides pwsh on every OS. */
function managedArgv(entry: GuidedManaged): readonly (readonly string[])[] | undefined {
  switch (entry.kind) {
    case 'go': {
      return [['go', 'install', `${entry.id}@${entry.version}`]]
    }
    case 'cargo': {
      return [['cargo', 'install', '--locked', entry.id, '--version', stripV(entry.version)]]
    }
    case 'npm': {
      return [['npm', 'install', '--global', `${entry.id}@${entry.version}`]]
    }
    case 'uvTools': {
      return [['uv', 'tool', 'install', `${entry.id}==${entry.version}`]]
    }
    case 'uvPythons': {
      return [['uv', 'python', 'install', entry.version]]
    }
    case 'psGallery': {
      return [
        [
          'pwsh',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Install-Module -Name ${entry.id} -RequiredVersion ${entry.version} -Scope CurrentUser`,
        ],
      ]
    }
    case 'rust': {
      const install: (readonly string[])[] = [['rustup', 'toolchain', 'install', entry.version]]
      if (!entry.version.startsWith('nightly')) {
        install.push(['rustup', 'default', entry.version])
      }
      return install
    }
    default: {
      return undefined
    }
  }
}

export function planGuidedInstall(
  os: string,
  tools: readonly GuidedTool[],
  managed: readonly GuidedManaged[],
): GuidedPlan {
  const steps: GuidedStep[] = []
  const blocked: GuidedBlocked[] = []
  const block = (tool: string, version: string): void => {
    blocked.push({ tool, version, code: 'manual-install' })
  }
  if (os !== 'windows' && os !== 'macos' && os !== 'linux') {
    for (const tool of tools) block(tool.tool, tool.version)
    for (const entry of managed) block(entry.id, entry.version)
    return { steps, blocked }
  }
  const emitted = new Set<string>()
  let isAptUpdated = false
  const ensureAptUpdated = (): void => {
    if (isAptUpdated) {
      return
    }

    isAptUpdated = true
    steps.push({ kind: 'install', argv: ['sudo', 'apt', 'update'] })
  }
  const didManagerInstall = (tool: string, version: string): boolean => {
    const entry = OS_PACKAGES[tool]
    if (os === 'windows') {
      const id = majorId(WINGET_MAJOR_IDS, tool, version) ?? entry?.winget
      if (id === undefined) return false
      steps.push({ kind: 'install', argv: wingetInstall(id, version) })
      return true
    }
    if (os === 'macos') {
      const cask = majorId(BREW_MAJOR_CASKS, tool, version)
      if (cask !== undefined) {
        steps.push({ kind: 'install', argv: brewInstall(cask, true) })
        return true
      }
      if (entry?.brew === undefined) return false
      steps.push({ kind: 'install', argv: brewInstall(entry.brew, entry.brewCask === true) })
      if (entry.brewLink === true)
        steps.push({ kind: 'install', argv: ['brew', 'link', entry.brew] })
      return true
    }
    if (entry?.apt === undefined) return false
    ensureAptUpdated()
    steps.push({ kind: 'install', argv: aptInstall(entry.apt) })
    return true
  }
  /** uv on apt bootstraps from the distro Python, pinned through pip. */
  const installUvApt = (version: string): void => {
    ensureAptUpdated()
    steps.push(
      { kind: 'install', argv: aptInstall(['python3', 'python3-pip']) },
      { kind: 'install', argv: ['python3', '-m', 'pip', 'install', '--user', `uv==${version}`] },
    )
  }
  const installTool = (tool: string, version: string): void => {
    if (emitted.has(tool)) return
    emitted.add(tool)
    if (tool === 'uv' && os === 'linux') {
      installUvApt(version)
      return
    }
    if (!didManagerInstall(tool, version)) block(tool, version)
  }
  for (const tool of tools) installTool(tool.tool, tool.version)
  for (const entry of managed) {
    const argv = managedArgv(entry)
    if (argv === undefined) {
      block(entry.id, entry.version)
      continue
    }
    for (const command of argv) steps.push({ kind: 'install', argv: command })
  }
  for (const tool of tools) steps.push({ kind: 'check', argv: tool.check, want: tool.version })
  for (const entry of managed) steps.push({ kind: 'check', argv: entry.check, want: entry.version })
  return { steps, blocked }
}
