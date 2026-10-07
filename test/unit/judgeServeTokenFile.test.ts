import './helpers/tokenFileMocks'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createJudgeTokenFile } from '../../src/runtime/judge/tokenFile'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { tokenFileSuite } from './helpers/tokenFileSuite'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})
tokenFileSuite(createJudgeTokenFile, 'EJUDGE_TOKEN_ACL', /^muse-judge-/)

it('reads the installed translation when token protection refuses startup', async () => {
  const parent = await mkdtemp(path.join(process.cwd(), '.judge-token-l10n-'))
  try {
    setUiText({ ...EN, judgeNoAnswer: 'Kein Urteil ({reason}).' }, 'de')
    await expect(
      createJudgeTokenFile(parent, { secure: () => Promise.resolve({}) }),
    ).rejects.toThrow('Kein Urteil (EJUDGE_TOKEN_ACL).')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
