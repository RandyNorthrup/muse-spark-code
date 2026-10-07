import { PLAYBOOK_MODEL_TEXT } from '../../shared/constants'

/** Read only for a playbook review, through the existing lazy skills bundle. */
export function playbookReviewerCharter(): string {
  return PLAYBOOK_MODEL_TEXT.playbookReviewInstructions
}
