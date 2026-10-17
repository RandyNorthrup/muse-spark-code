// Safer Windows paths (SECWINPATH): the shared spelling refusal, through the
// real module with an explicit win32 platform, so it runs on every OS with no
// stand-in. Each case names the rule that must fire for that spelling.

import { describe, expect, it } from 'vitest'
import { WINDOWS_PATH_MODEL_TEXT } from '../../src/shared/constants'
import {
  isUncPath,
  isWindowsDeviceLike,
  normalWindowsPath,
  windowsPathProblem,
} from '../../src/core/windowsPathSpelling'

const problem = (given: string, workspaceRoot?: string) =>
  windowsPathProblem(given, 'win32', workspaceRoot)

describe('windowsPathProblem', () => {
  it('does nothing away from Windows, even for a device spelling', () => {
    expect(windowsPathProblem(String.raw`C:\x\con`, 'darwin')).toBeUndefined()
    expect(windowsPathProblem(String.raw`C:\x\con`, 'linux')).toBeUndefined()
  })

  it('refuses reserved devices, including superscript spellings', () => {
    for (const name of ['con', 'prn', 'aux', 'nul', 'com1', 'lpt9', 'conin$', 'conout$']) {
      expect(problem(`C:\\x\\${name}`)).toBe(WINDOWS_PATH_MODEL_TEXT.windowsReservedDevice)
    }
    expect(problem(String.raw`C:\x\com¹`)).toBe(WINDOWS_PATH_MODEL_TEXT.windowsReservedDevice)
    expect(problem(String.raw`C:\x\NUL `)).toBe(WINDOWS_PATH_MODEL_TEXT.windowsReservedDevice)
  })

  it('leaves ordinary dotted names alone: con.d is a normal file on Windows 11', () => {
    for (const name of ['con.d', 'aux.js', 'nul.txt']) {
      expect(problem(`C:\\x\\${name}`)).toBeUndefined()
    }
  })

  it('refuses names Windows silently drops characters from', () => {
    expect(problem(String.raw`C:\x\name.`)).toBe(WINDOWS_PATH_MODEL_TEXT.windowsTrailingName)
    expect(problem(String.raw`C:\x\name `)).toBe(WINDOWS_PATH_MODEL_TEXT.windowsTrailingName)
  })

  it('refuses alternate data streams', () => {
    expect(problem(String.raw`C:\x\file.txt:zone`)).toBe(
      WINDOWS_PATH_MODEL_TEXT.windowsAlternateStream,
    )
  })

  it('refuses drive-relative spellings but accepts rooted ones', () => {
    expect(problem('C:foo')).toBe(WINDOWS_PATH_MODEL_TEXT.windowsDriveRelative)
    expect(problem(String.raw`C:\foo`)).toBeUndefined()
    expect(problem('C:/foo')).toBeUndefined()
  })

  it('applies segment rules after a local verbatim prefix', () => {
    expect(problem(String.raw`\\?\C:\x\ok`)).toBeUndefined()
    expect(problem(String.raw`\\?\C:\x\con`)).toBe(WINDOWS_PATH_MODEL_TEXT.windowsReservedDevice)
  })

  it('refuses non-local verbatim and device namespaces', () => {
    for (const given of [
      String.raw`\\?\UNC\srv\share\x`,
      String.raw`\\?\Volume{b75e2c83-0000-0000-0000-602f nasc}\x`,
      String.raw`\\.\C:\x`,
      String.raw`\??\C:\x`,
    ]) {
      expect(problem(given)).toBe(WINDOWS_PATH_MODEL_TEXT.windowsDeviceNamespace)
    }
  })

  it('refuses UNC outside a UNC workspace, admits it inside one', () => {
    const unc = String.raw`\\srv\share\x`
    expect(problem(unc)).toBe(WINDOWS_PATH_MODEL_TEXT.windowsUncOutsideWorkspace)
    expect(problem(unc, String.raw`C:\work`)).toBe(
      WINDOWS_PATH_MODEL_TEXT.windowsUncOutsideWorkspace,
    )
    expect(problem(unc, String.raw`\\srv\share\work`)).toBeUndefined()
  })

  it('skips navigation segments: containment is the caller’s check', () => {
    expect(problem(String.raw`C:\x\..\y`)).toBeUndefined()
  })
})

describe('normalWindowsPath', () => {
  it('strips only a local verbatim drive prefix', () => {
    expect(normalWindowsPath(String.raw`\\?\C:\x`)).toBe(String.raw`C:\x`)
    expect(normalWindowsPath(String.raw`\\?\UNC\srv\share`)).toBe(String.raw`\\?\UNC\srv\share`)
    expect(normalWindowsPath(String.raw`C:\x`)).toBe(String.raw`C:\x`)
  })
})

describe('isUncPath', () => {
  it('sees backslash and forward-slash UNC, not device namespaces', () => {
    expect(isUncPath(String.raw`\\srv\share\x`)).toBe(true)
    expect(isUncPath('//srv/share/x')).toBe(true)
    expect(isUncPath(String.raw`\\?\C:\x`)).toBe(false)
    expect(isUncPath(String.raw`C:\x`)).toBe(false)
  })
})

describe('isWindowsDeviceLike', () => {
  it('stays conservative for pull-request trees', () => {
    expect(isWindowsDeviceLike('con.d')).toBe(true)
    expect(isWindowsDeviceLike('com0')).toBe(true)
    expect(isWindowsDeviceLike('ordinary.ts')).toBe(false)
  })
})
