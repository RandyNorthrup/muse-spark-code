# Installation

Current stable release: **v0.7.0**.

Choose one source and keep its trust model explicit:

| Need | Recommended source |
|---|---|
| Normal Claude Code use with marketplace updates | GitHub marketplace |
| Reproducible Claude Code install | Marketplace pinned to `v0.7.0` |
| Any coding agent or vendored copy | Tagged clone or release archive |
| Offline inspection after download | Verified release archive |

Windows uses native PowerShell. Bash is not required on Windows.

## Claude Code marketplace

Inside Claude Code:

```text
/plugin marketplace add RandyNorthrup/high-quality-projects-skill
/plugin install high-quality-projects-skill@high-quality-projects-skill
/reload-plugins
```

Equivalent terminal commands install at user scope:

```console
claude plugin marketplace add RandyNorthrup/high-quality-projects-skill
claude plugin install high-quality-projects-skill@high-quality-projects-skill --scope user
```

These commands follow Anthropic's documented GitHub marketplace flow. The
unpinned repository source receives marketplace updates. To pin an immutable
version, add the Git URL with its tag instead:

```text
/plugin marketplace add https://github.com/RandyNorthrup/high-quality-projects-skill.git#v0.7.0
/plugin install high-quality-projects-skill@high-quality-projects-skill
/reload-plugins
```

Claude Code also accepts an extracted local release directory containing
`.claude-plugin/marketplace.json`:

```text
/plugin marketplace add C:\path\to\high-quality-projects-skill-v0.7.0
/plugin install high-quality-projects-skill@high-quality-projects-skill
/reload-plugins
```

## Tagged Git clone

Use this for an inspectable, immutable checkout shared by any coding agent:

```console
git clone --branch v0.7.0 --depth 1 https://github.com/RandyNorthrup/high-quality-projects-skill.git
```

Direct the agent to read `AGENTS.md`, then the selected workflow file in full.
Do not copy only `SKILL.md`; the workflows depend on `scripts/`, `templates/`,
and their bundled references and assets.

## Codex skill registration

Keep one complete source clone and register its three skill directories. On
Windows, the following example uses junctions under `~/.agents/skills` so shared
package resources remain available. Run it only for destinations that do not
already exist; inspect and update existing installations in place.

```powershell
$PackageSource = Join-Path $env:USERPROFILE '.agents\skill-sources\high-quality-projects-skill'
git clone --branch v0.7.0 --depth 1 https://github.com/RandyNorthrup/high-quality-projects-skill.git $PackageSource
$SkillDirectory = Join-Path $env:USERPROFILE '.agents\skills'
New-Item -ItemType Directory -Path $SkillDirectory -Force | Out-Null
foreach ($WorkflowName in @('project_setup', 'feature_delivery', 'quality_retrofit')) {
    New-Item -ItemType Junction -Path (Join-Path $SkillDirectory $WorkflowName) `
        -Target (Join-Path $PackageSource "skills\$WorkflowName")
}
```

On Linux/macOS, use directory symlinks from the same skill-discovery directory to
the three folders in the complete checkout. A normal directory copy must retain
the complete package and its shared resource paths; a lone `SKILL.md` is insufficient.

Start a fresh Codex session or refresh its skill inventory and verify all three
workflows are enabled. Depending on discovery/packaging, the displayed names may
include `high-quality-projects-skill:`. Follow the names shown in that inventory.
When updating, verify the new release, fast-forward the clean source clone, and
recheck discovery and resource resolution. Preserve existing junctions and user
changes; never force-reset a modified installation.

## GitHub Release archive

Download all v0.7.0 assets with GitHub CLI:

```console
gh release download v0.7.0 --repo RandyNorthrup/high-quality-projects-skill --dir high-quality-projects-skill-v0.7.0-release
```

Each release contains:

- `high-quality-projects-skill-v0.7.0.zip`
- `high-quality-projects-skill-v0.7.0.tar.gz`
- `SHA256SUMS.txt`
- `release-manifest.json`
- `RELEASE_NOTES.md`

The archives contain the exact tagged Git tree under one versioned top-level
directory. `release-manifest.json` records the tag, commit, sizes, and archive
hashes. `SHA256SUMS.txt` covers both archives, the manifest, and release notes.

### Verify SHA-256 on Windows

```powershell
$ReleaseRoot = (Resolve-Path '.\high-quality-projects-skill-v0.7.0-release').Path
Get-Content (Join-Path $ReleaseRoot 'SHA256SUMS.txt') | ForEach-Object {
    if ($_ -notmatch '^([0-9a-f]{64})  (.+)$') {
        throw "Malformed checksum line: $_"
    }
    $ExpectedHash = $Matches[1]
    $ArtifactPath = Join-Path $ReleaseRoot $Matches[2]
    $ActualHash = (Get-FileHash -LiteralPath $ArtifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualHash -ne $ExpectedHash) {
        throw "Checksum mismatch: $ArtifactPath"
    }
}
Write-Output 'Release checksums verified.'
```

### Verify SHA-256 on Linux

```bash
cd high-quality-projects-skill-v0.7.0-release
sha256sum --check SHA256SUMS.txt
```

On macOS, use `shasum -a 256 -c SHA256SUMS.txt`.

### Verify GitHub build provenance

The release workflow creates signed GitHub attestations for both archives.
After downloading one, verify its repository and signer workflow:

```console
gh attestation verify high-quality-projects-skill-v0.7.0.zip --repo RandyNorthrup/high-quality-projects-skill --signer-workflow RandyNorthrup/high-quality-projects-skill/.github/workflows/release.yml
```

Checksums detect corruption. Attestation verification additionally checks that
the archive was produced by this repository's release workflow.

## Extract and use

PowerShell:

```powershell
Expand-Archive -LiteralPath '.\high-quality-projects-skill-v0.7.0.zip' -DestinationPath .
```

Linux or macOS:

```bash
tar -xzf high-quality-projects-skill-v0.7.0.tar.gz
```

Then read `high-quality-projects-skill-v0.7.0/AGENTS.md` or add that extracted
directory as a local Claude Code marketplace.

## Updating

For an unpinned Claude Code marketplace:

```text
/plugin marketplace update high-quality-projects-skill
/reload-plugins
```

Pinned tags and extracted archives do not auto-update. Verify and install a new
release deliberately when ready.
