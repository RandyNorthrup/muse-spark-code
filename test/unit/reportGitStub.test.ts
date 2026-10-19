import { EN } from '../../src/shared/l10n/en'
import { describe, expect, it } from 'vitest'
import {
  XcodeStubGitError,
  gitSource,
  isXcodeStubGitError,
  isXcodeStubGitFailure,
} from '../../src/core/reporting/sources/git'
import { sourceContextFor } from './helpers/reporting/reasonCases'

// Recorded 2026-10-18: `/usr/bin/git --version` on a Mac whose developer
// directory points at a missing Xcode, with no Command Line Tools path set.
const STUB_EXIT_CODE = 71
const STUB_STDERR = `git: error: couldn't spawn '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild' (errno=No such file or directory)
git: error: unable to locate xcodebuild, please make sure the path to the Xcode folder is set correctly!
git: error: You can set the path to the Xcode folder using /usr/bin/xcode-select -switch`

describe('Xcode stub git detection', () => {
  it('recognizes the recorded stub failure', () => {
    expect(isXcodeStubGitFailure('darwin', STUB_EXIT_CODE, STUB_STDERR)).toBe(true)
  })

  it('refuses anything but the stub shape', () => {
    expect(isXcodeStubGitFailure('linux', STUB_EXIT_CODE, STUB_STDERR)).toBe(false)
    expect(isXcodeStubGitFailure('darwin', 1, STUB_STDERR)).toBe(false)
    expect(isXcodeStubGitFailure('darwin', STUB_EXIT_CODE, 'error: unknown option')).toBe(false)
    expect(isXcodeStubGitFailure('darwin', undefined, STUB_STDERR)).toBe(false)
  })

  it('brands the stub error across bundle copies', () => {
    expect(isXcodeStubGitError(new XcodeStubGitError())).toBe(true)
    // The lazy inputs bundle carries its own copy of the class, so a copy
    // shaped like the brand (not `instanceof`) must still match.
    expect(isXcodeStubGitError({ name: 'XcodeStubGitError', isXcodeStubGitError: true })).toBe(true)
    expect(isXcodeStubGitError(new Error('xcode-stub-git'))).toBe(false)
  })
})

describe('git report source on stub git', () => {
  it('names the cause and the fix instead of a raw exit code', async () => {
    const source = gitSource(
      {
        run: () => {
          throw new XcodeStubGitError()
        },
      },
      (text) => text,
    )
    const result = await source.read(sourceContextFor('project'))
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(EN.reportUi.gitXcodeStub)
    expect(result.data).toBeNull()
  })
})
