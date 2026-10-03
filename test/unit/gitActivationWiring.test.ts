import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// src/extension.ts is excluded from the unit run (vitest.config.ts): what a
// unit test can hold it to is the wiring of git and pull requests (M71) to the
// window's checkpoint, trust and admission primitives (M72, PLAN.md D51).
const source = readFileSync(
  fileURLToPath(new URL('../../src/extension.ts', import.meta.url)),
  'utf8',
)

describe('activation wires git and pull requests to the window’s guards (M71)', () => {
  it('admits a commit and a push as a process that may write the workspace', () => {
    expect(source).toMatch(
      /admit:\s*\(start\)\s*=>\s*backend\.startWorkspaceCommand\(start,\s*nativeStarts\.signal\)/,
    )
  })

  it('gives the window the folder as selected, and its own closing as its activation', () => {
    // Made in the conversation Git bundle from these primitives (PLAN.md D6).
    expect(source).toMatch(/gitFeaturesLoader\(conversationGit,\s*\{\s*workspaceRoot,/)
    expect(source).toMatch(/const workspaceRoot = firstFolderPath\(\)/)
    expect(source).toMatch(
      /holdFor\(\s*workspaceRoot === undefined \? \[\] : pathSpellings\(workspaceRoot\),/,
    )
    expect(source).toMatch(/isCurrent:\s*\(\)\s*=>\s*!nativeStarts\.signal\.aborted,/)
    expect(source).not.toContain('isClosing')
  })

  it('builds every conversation adapter and the pull request command over the one lazy window', () => {
    expect(source).toMatch(/createGit:\s*conversationGitFactory\(conversationGit,\s*gitFeatures\),/)
    // The panel's action and the palette command take the same refusal path.
    expect(
      source.match(/openPullRequestInConversation\(gitFeatures,\s*gitPopups\.showError\)/g),
    ).toHaveLength(2)
  })

  it('carries a worktree command’s last check through the admission to Git', () => {
    expect(source).toMatch(
      /mutationGit:\s*\(args,\s*cwd,\s*timeoutMs,\s*beforeRun\)\s*=>\s*backend\.startWorktreeMutation\(\s*cwd,\s*\(ownedCwd\)\s*=>\s*runGit\(args,\s*ownedCwd,\s*timeoutMs,\s*beforeRun\),\s*nativeStarts\.signal,\s*\)/,
    )
  })

  it('reads a held pull request worktree as untrusted wherever git or the shell would run', () => {
    // Checkpoints run git in the workspace, the file list runs `git ls-files`,
    // and the verify loop names the user's check commands: none in a held window.
    expect(source).toMatch(
      /store:\s*checkpointStore,\s*(?:\/\/[^\n]*\s*)*isWorkspaceTrusted:\s*isProjectTrusted,/,
    )
    expect(source).toMatch(
      /respectGitIgnore:\s*\(\)\s*=>\s*currentSettings\(\)\.respectGitIgnore,\s*isWorkspaceTrusted:\s*isProjectTrusted,/,
    )
    expect(source).toMatch(/isProjectTrusted\(\)\s*\?\s*settings\.checkCommands\s*:\s*\[\]/)
    expect(source).not.toMatch(/vscode\.workspace\.isTrusted\s*\?\s*settings\.checkCommands/)
    // The environment facts carry commit subjects: the same rule at the git call's own gate.
    expect(source).toMatch(/!isProjectTrusted\(\)\s*\|\|\s*!isSamePath\(cwd,\s*workspaceRoot,/)
  })
})
