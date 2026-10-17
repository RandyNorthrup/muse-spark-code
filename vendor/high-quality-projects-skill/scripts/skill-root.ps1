# Print the root directory of this package -- the directory containing
# scripts/ and templates/.
#
# Resolution order:
#   1. $env:SKILL_ROOT         - explicit override
#   2. $env:CLAUDE_PLUGIN_ROOT - set automatically by Claude Code
#   3. this script's parent directory
#
# Always exits 0 and prints an absolute path.

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-AbsolutePath {
    param(
        [Parameter(Mandatory)]
        [string] $Path
    )

    $expandedPath = [Environment]::ExpandEnvironmentVariables($Path)
    if ([IO.Path]::IsPathRooted($expandedPath)) {
        return [IO.Path]::GetFullPath($expandedPath)
    }

    return [IO.Path]::GetFullPath((Join-Path -Path (Get-Location).Path -ChildPath $expandedPath))
}

if (-not [string]::IsNullOrWhiteSpace($env:SKILL_ROOT)) {
    Write-Output (ConvertTo-AbsolutePath -Path $env:SKILL_ROOT)
    exit 0
}

if (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_PLUGIN_ROOT)) {
    Write-Output (ConvertTo-AbsolutePath -Path $env:CLAUDE_PLUGIN_ROOT)
    exit 0
}

# Follow a symlinked script when the host exposes link metadata. Older Windows
# PowerShell versions do not expose LinkType, so they safely use PSCommandPath.
$scriptItem = Get-Item -LiteralPath $PSCommandPath -Force
$linkTypeProperty = $scriptItem.PSObject.Properties['LinkType']
while ($null -ne $linkTypeProperty -and $null -ne $linkTypeProperty.Value) {
    $targetProperty = $scriptItem.PSObject.Properties['Target']
    if ($null -eq $targetProperty -or $null -eq $targetProperty.Value) {
        break
    }

    $linkTarget = @($targetProperty.Value)[0]
    if (-not [IO.Path]::IsPathRooted($linkTarget)) {
        $linkTarget = Join-Path -Path $scriptItem.DirectoryName -ChildPath $linkTarget
    }

    $scriptItem = Get-Item -LiteralPath $linkTarget -Force
    $linkTypeProperty = $scriptItem.PSObject.Properties['LinkType']
}

$packageRoot = [IO.Path]::GetFullPath((Join-Path -Path $scriptItem.DirectoryName -ChildPath '..'))
Write-Output $packageRoot
exit 0
