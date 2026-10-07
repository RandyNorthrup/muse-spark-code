// Judge and companion boundaries share the same owner-only token lifecycle.
import { createTokenFile, type TokenWindowsAcl } from '../tokenFile'
import { JUDGE_TOKEN_DIRECTORY_PREFIX } from '../../shared/constants'
import { fill, UI_TEXT } from '../../shared/l10n/text'

export type JudgeWindowsAcl = TokenWindowsAcl

export async function createJudgeTokenFile(parent: string, acl?: JudgeWindowsAcl) {
  try {
    return await createTokenFile(parent, acl, JUDGE_TOKEN_DIRECTORY_PREFIX)
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'ETOKEN_ACL')
      throw new Error(fill(UI_TEXT.judgeNoAnswer, { reason: 'EJUDGE_TOKEN_ACL' }), { cause: error })
    throw error
  }
}
