# Inventory a workspace before changing anything.
#
# Emits JSON describing languages, existing quality configuration, installed
# tools, and the best available Python runtime. This is the PowerShell-native
# counterpart to detect-stack.sh; it does not require Bash or WSL.
#
# Exit code: 0 always. An unreadable workspace is reported as JSON.

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string] $Root = '.'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-ScanError {
    param(
        [Parameter(Mandatory)]
        [string] $Message
    )

    [ordered]@{ error = $Message } | ConvertTo-Json -Compress
}

function Test-CommandAvailable {
    param(
        [Parameter(Mandatory)]
        [string] $Name
    )

    return $null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Get-SourceCount {
    param(
        [Parameter(Mandatory)]
        [string] $WorkspaceRoot
    )

    $maximumFilesPerExtension = 5000
    $extensionCounts = @{}
    foreach ($extension in @(
            '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.rs', '.cs',
            '.cpp', '.cc', '.cxx', '.hpp', '.h', '.ps1', '.psm1', '.css',
            '.scss', '.html', '.sh', '.go'
        )) {
        $extensionCounts[$extension] = 0
    }

    $prunedDirectories = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::OrdinalIgnoreCase
    )
    foreach ($directoryName in @(
            'node_modules', '.git', 'dist', 'build', 'target', 'vendor',
            '.venv', 'venv', '__pycache__', 'bin', 'obj'
        )) {
        [void] $prunedDirectories.Add($directoryName)
    }

    $pendingDirectories = [Collections.Generic.Stack[string]]::new()
    $pendingDirectories.Push($WorkspaceRoot)

    while ($pendingDirectories.Count -gt 0) {
        $currentDirectory = $pendingDirectories.Pop()

        try {
            foreach ($filePath in [IO.Directory]::EnumerateFiles($currentDirectory)) {
                $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
                if (
                    $extensionCounts.ContainsKey($extension) -and
                    $extensionCounts[$extension] -lt $maximumFilesPerExtension
                ) {
                    $extensionCounts[$extension]++
                }
            }
        }
        catch [UnauthorizedAccessException] {
            continue
        }
        catch [IO.IOException] {
            continue
        }

        try {
            foreach ($directoryPath in [IO.Directory]::EnumerateDirectories($currentDirectory)) {
                $directoryName = [IO.Path]::GetFileName($directoryPath)
                if ($prunedDirectories.Contains($directoryName)) {
                    continue
                }

                try {
                    $attributes = [IO.File]::GetAttributes($directoryPath)
                    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                        continue
                    }
                }
                catch [UnauthorizedAccessException] {
                    continue
                }
                catch [IO.IOException] {
                    continue
                }

                $pendingDirectories.Push($directoryPath)
            }
        }
        catch [UnauthorizedAccessException] {
            continue
        }
        catch [IO.IOException] {
            continue
        }
    }

    return $extensionCounts
}

function Test-WorkspacePath {
    param(
        [Parameter(Mandatory)]
        [string] $WorkspaceRoot,

        [Parameter(Mandatory)]
        [string] $RelativePath
    )

    return Test-Path -LiteralPath (Join-Path -Path $WorkspaceRoot -ChildPath $RelativePath)
}

function Test-AnyWorkspacePath {
    param(
        [Parameter(Mandatory)]
        [string] $WorkspaceRoot,

        [Parameter(Mandatory)]
        [string[]] $RelativePath
    )

    foreach ($candidate in $RelativePath) {
        if (Test-WorkspacePath -WorkspaceRoot $WorkspaceRoot -RelativePath $candidate) {
            return $true
        }
    }
    return $false
}

function Get-PresentWorkspacePath {
    param(
        [Parameter(Mandatory)]
        [string] $WorkspaceRoot,

        [Parameter(Mandatory)]
        [string[]] $RelativePath
    )

    # Keep the declared order so both scanners emit identical arrays.
    return , [string[]] @(
        $RelativePath | Where-Object {
            Test-WorkspacePath -WorkspaceRoot $WorkspaceRoot -RelativePath $_
        }
    )
}

function Test-PowerShellModule {
    param(
        [Parameter(Mandatory)]
        [string] $Name,

        [int] $MinimumMajorVersion = 0
    )

    # Gate modules live in the module path, not on PATH. Pester 3.x ships inside
    # Windows PowerShell but cannot run Pester 5 tests, so callers set a floor.
    $modules = @(
        Get-Module -ListAvailable -Name $Name -ErrorAction SilentlyContinue |
            Where-Object { $_.Version.Major -ge $MinimumMajorVersion }
    )
    return $modules.Count -gt 0
}

try {
    $resolvedRoot = (Resolve-Path -LiteralPath $Root -ErrorAction Stop).ProviderPath
    if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
        throw 'Path is not a readable directory.'
    }
}
catch {
    Write-ScanError -Message 'unreadable path'
    exit 0
}

try {
    $counts = Get-SourceCount -WorkspaceRoot $resolvedRoot

    $pythonProbe = @'
import importlib.util

modules = ('ruff', 'mypy', 'vulture', 'bandit', 'pip_audit',
           'deptry', 'pytest', 'semgrep', 'pre_commit')
found = []
for module in modules:
    try:
        if importlib.util.find_spec(module) is not None:
            found.append(module)
    except (ImportError, ValueError):
        pass
print(' '.join(found))
'@

    $pythonBin = ''
    $pythonModules = @()
    $bestModuleCount = -1
    foreach ($candidate in @('python3', 'python', 'py')) {
        if (-not (Test-CommandAvailable -Name $candidate)) {
            continue
        }

        try {
            $probeOutput = & $candidate -c $pythonProbe 2>$null
        }
        catch {
            continue
        }
        if ($LASTEXITCODE -ne 0) {
            continue
        }

        $joinedOutput = ($probeOutput -join [Environment]::NewLine).Trim()
        $foundModules = @()
        if ($joinedOutput.Length -gt 0) {
            $foundModules = @(
                $joinedOutput -split '\s+' | Where-Object { $_.Length -gt 0 }
            )
        }

        if ($foundModules.Count -gt $bestModuleCount) {
            $bestModuleCount = $foundModules.Count
            $pythonBin = $candidate
            $pythonModules = $foundModules
        }
    }

    function Test-PythonToolAvailable {
        param(
            [Parameter(Mandatory)]
            [string] $CommandName,

            [Parameter(Mandatory)]
            [string] $ModuleName
        )

        return (
            (Test-CommandAvailable -Name $CommandName) -or
            $pythonModules -contains $ModuleName
        )
    }

    $moduleOnlyTools = @()
    foreach ($moduleName in $pythonModules) {
        $commandName = $moduleName.Replace('_', '-')
        if (-not (Test-CommandAvailable -Name $commandName)) {
            $moduleOnlyTools += $moduleName
        }
    }

    $gitAvailable = Test-CommandAvailable -Name 'git'
    $hasRemote = $false
    $trackedFileCount = 0
    if ($gitAvailable -and (Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.git')) {
        $remoteNames = @(& git -C $resolvedRoot remote 2>$null)
        $hasRemote = $LASTEXITCODE -eq 0 -and $remoteNames.Count -gt 0

        $trackedFiles = @(& git -C $resolvedRoot ls-files 2>$null)
        if ($LASTEXITCODE -eq 0) {
            $trackedFileCount = $trackedFiles.Count
        }
    }

    $result = [ordered]@{
        root = $resolvedRoot
        git = [ordered]@{
            is_repo = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.git'
            has_remote = $hasRemote
            tracked_files = $trackedFileCount
        }
        languages = [ordered]@{
            python = $counts['.py']
            typescript = $counts['.ts'] + $counts['.tsx']
            javascript = $counts['.js'] + $counts['.jsx'] + $counts['.mjs']
            rust = $counts['.rs']
            csharp = $counts['.cs']
            cpp = $counts['.cpp'] + $counts['.cc'] + $counts['.cxx'] + $counts['.hpp'] + $counts['.h']
            powershell = $counts['.ps1'] + $counts['.psm1']
            css = $counts['.css'] + $counts['.scss']
            html = $counts['.html']
            shell = $counts['.sh']
            go = $counts['.go']
        }
        existing_config = [ordered]@{
            pyproject_toml = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'pyproject.toml'
            ruff_toml = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'ruff.toml'
            setup_cfg = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'setup.cfg'
            mypy_ini = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'mypy.ini'
            tox_ini = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'tox.ini'
            package_json = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'package.json'
            tsconfig_json = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'tsconfig.json'
            eslint_config_mjs = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'eslint.config.mjs'
            eslint_config_js = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'eslint.config.js'
            eslintrc_json = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.eslintrc.json'
            eslintrc_cjs = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.eslintrc.cjs'
            prettierrc = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.prettierrc'
            stylelintrc_json = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.stylelintrc.json'
            knip_json = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'knip.json'
            knip_jsonc = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'knip.jsonc'
            cargo_toml = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'Cargo.toml'
            clippy_toml = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'clippy.toml'
            deny_toml = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'deny.toml'
            rustfmt_toml = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'rustfmt.toml'
            go_mod = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'go.mod'
            golangci = Test-AnyWorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath @(
                '.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json'
            )
            clang_tidy = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.clang-tidy'
            clang_format = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.clang-format'
            cmakelists = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'CMakeLists.txt'
            directory_build_props = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'Directory.Build.props'
            editorconfig = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.editorconfig'
            psscriptanalyzer = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'PSScriptAnalyzerSettings.psd1'
            pre_commit = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.pre-commit-config.yaml'
            gitignore = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.gitignore'
            gitattributes = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.gitattributes'
            env_example = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.env.example'
            dockerfile = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'Dockerfile'
            github_workflows = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath '.github/workflows'
            dependabot = Test-AnyWorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath @(
                '.github/dependabot.yml', '.github/dependabot.yaml'
            )
            renovate = Test-AnyWorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath @(
                'renovate.json', 'renovate.json5', '.github/renovate.json',
                '.github/renovate.json5', '.renovaterc', '.renovaterc.json'
            )
            readme = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'README.md'
            changelog = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'CHANGELOG.md'
            plan = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'PLAN.md'
            license = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'LICENSE'
            agents_md = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'AGENTS.md'
            claude_md = Test-WorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath 'CLAUDE.md'
        }
        # Dependency locks and runtime/toolchain pins, in a fixed order.
        lockfiles = Get-PresentWorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath @(
            'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock',
            'bun.lock', 'bun.lockb', 'uv.lock', 'poetry.lock', 'Pipfile.lock', 'pdm.lock',
            'Cargo.lock', 'go.sum', 'packages.lock.json'
        )
        toolchain_pins = Get-PresentWorkspacePath -WorkspaceRoot $resolvedRoot -RelativePath @(
            '.python-version', '.nvmrc', '.node-version', '.tool-versions',
            'rust-toolchain.toml', 'rust-toolchain', 'global.json'
        )
        tools_installed = [ordered]@{
            ruff = Test-PythonToolAvailable -CommandName 'ruff' -ModuleName 'ruff'
            mypy = Test-PythonToolAvailable -CommandName 'mypy' -ModuleName 'mypy'
            vulture = Test-PythonToolAvailable -CommandName 'vulture' -ModuleName 'vulture'
            bandit = Test-PythonToolAvailable -CommandName 'bandit' -ModuleName 'bandit'
            pip_audit = Test-PythonToolAvailable -CommandName 'pip-audit' -ModuleName 'pip_audit'
            deptry = Test-PythonToolAvailable -CommandName 'deptry' -ModuleName 'deptry'
            pytest = Test-PythonToolAvailable -CommandName 'pytest' -ModuleName 'pytest'
            semgrep = Test-PythonToolAvailable -CommandName 'semgrep' -ModuleName 'semgrep'
            node = Test-CommandAvailable -Name 'node'
            npm = Test-CommandAvailable -Name 'npm'
            tsc = Test-CommandAvailable -Name 'tsc'
            eslint = Test-CommandAvailable -Name 'eslint'
            prettier = Test-CommandAvailable -Name 'prettier'
            stylelint = Test-CommandAvailable -Name 'stylelint'
            knip = Test-CommandAvailable -Name 'knip'
            dpdm = Test-CommandAvailable -Name 'dpdm'
            htmlhint = Test-CommandAvailable -Name 'htmlhint'
            jscpd = Test-CommandAvailable -Name 'jscpd'
            madge = Test-CommandAvailable -Name 'madge'
            cargo = Test-CommandAvailable -Name 'cargo'
            cargo_audit = Test-CommandAvailable -Name 'cargo-audit'
            cargo_machete = Test-CommandAvailable -Name 'cargo-machete'
            cargo_deny = Test-CommandAvailable -Name 'cargo-deny'
            go = Test-CommandAvailable -Name 'go'
            gofmt = Test-CommandAvailable -Name 'gofmt'
            staticcheck = Test-CommandAvailable -Name 'staticcheck'
            govulncheck = Test-CommandAvailable -Name 'govulncheck'
            golangci_lint = Test-CommandAvailable -Name 'golangci-lint'
            dotnet = Test-CommandAvailable -Name 'dotnet'
            roslynator = Test-CommandAvailable -Name 'roslynator'
            gcc = Test-CommandAvailable -Name 'gcc'
            clang = Test-CommandAvailable -Name 'clang'
            clang_tidy = Test-CommandAvailable -Name 'clang-tidy'
            clang_format = Test-CommandAvailable -Name 'clang-format'
            cppcheck = Test-CommandAvailable -Name 'cppcheck'
            valgrind = Test-CommandAvailable -Name 'valgrind'
            gcovr = Test-CommandAvailable -Name 'gcovr'
            pwsh = Test-CommandAvailable -Name 'pwsh'
            psscriptanalyzer = Test-PowerShellModule -Name 'PSScriptAnalyzer'
            pester = Test-PowerShellModule -Name 'Pester' -MinimumMajorVersion 5
            shellcheck = Test-CommandAvailable -Name 'shellcheck'
            shfmt = Test-CommandAvailable -Name 'shfmt'
            bats = Test-CommandAvailable -Name 'bats'
            actionlint = Test-CommandAvailable -Name 'actionlint'
            zizmor = Test-CommandAvailable -Name 'zizmor'
            osv_scanner = Test-CommandAvailable -Name 'osv-scanner'
            hadolint = Test-CommandAvailable -Name 'hadolint'
            gitleaks = Test-CommandAvailable -Name 'gitleaks'
            pre_commit = Test-PythonToolAvailable -CommandName 'pre-commit' -ModuleName 'pre_commit'
        }
        python_runtime = [ordered]@{
            bin = $pythonBin
            module_only_tools = $moduleOnlyTools
        }
    }

    $result | ConvertTo-Json -Depth 5
}
catch {
    Write-ScanError -Message 'scan failed'
}

exit 0
