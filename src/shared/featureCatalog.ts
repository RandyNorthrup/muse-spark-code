import { PROMPT_COMMAND_IDS, UI_TEXT } from './constants'

/** Runtime localized inventory for M118; the reference generator uses the English fallback. */
export function sharingFeatures() {
  return [
    {
      id: 'sharing-help',
      surface: 'editor/acp',
      syntax: '/help',
      label: UI_TEXT.promptLibrary,
      detail: UI_TEXT.shareReviewPrivacy,
    },
    {
      id: PROMPT_COMMAND_IDS.save,
      surface: 'editor',
      syntax: 'museSpark.savePrompt',
      label: UI_TEXT.promptSave,
      detail: UI_TEXT.promptSecretsNote,
    },
    {
      id: PROMPT_COMMAND_IDS.use,
      surface: 'editor',
      syntax: 'museSpark.useSavedPrompt',
      label: UI_TEXT.promptUseSaved,
      detail: UI_TEXT.promptRun,
    },
    {
      id: PROMPT_COMMAND_IDS.library,
      surface: 'editor',
      syntax: 'museSpark.promptLibrary',
      label: UI_TEXT.promptLibrary,
      detail: `${UI_TEXT.promptScopeUser}; ${UI_TEXT.promptScopeWorkspace}`,
    },
    {
      id: PROMPT_COMMAND_IDS.copyToUser,
      surface: 'editor',
      syntax: 'museSpark.copyToMyPrompts',
      label: UI_TEXT.promptCopyToUser,
      detail: UI_TEXT.promptScopeUser,
    },
    {
      id: PROMPT_COMMAND_IDS.sharePrompt,
      surface: 'editor',
      syntax: 'museSpark.sharePrompt',
      label: UI_TEXT.sharePrompt,
      detail: UI_TEXT.shareReviewPrivacy,
    },
    {
      id: PROMPT_COMMAND_IDS.shareChat,
      surface: 'editor',
      syntax: 'museSpark.shareChat',
      label: UI_TEXT.shareChat,
      detail: `${UI_TEXT.shareConversation}; ${UI_TEXT.shareFull}`,
    },
    {
      id: 'museSpark.syncPromptsAndBookmarks',
      surface: 'setting',
      syntax: 'museSpark.syncPromptsAndBookmarks',
      label: UI_TEXT.promptLibrary,
      detail: UI_TEXT.promptScopeUser,
    },
    {
      id: 'share',
      surface: 'acp',
      syntax: '/share chat [--mode full|conversation] [--format md|html|json]',
      label: UI_TEXT.shareChat,
      detail: UI_TEXT.shareReviewPrivacy,
    },
    {
      id: 'prompt',
      surface: 'acp',
      syntax:
        '/prompt save --title TITLE [--scope user|workspace] -- TEXT; /prompt list; /prompt use ID; /prompt share ID',
      label: UI_TEXT.promptLibrary,
      detail: UI_TEXT.promptRun,
    },
    {
      id: 'share-cli',
      surface: 'cli',
      syntax: 'share chat SESSION_ID [--mode full|conversation] [--format md|html|json]',
      label: UI_TEXT.shareChat,
      detail: UI_TEXT.shareConfirm,
    },
    {
      id: 'prompts-save-cli',
      surface: 'cli',
      syntax: 'prompts save --title TITLE [--scope user|workspace] [--cwd FOLDER] < prompt.txt',
      label: UI_TEXT.promptLibrary,
      detail: UI_TEXT.promptRun,
    },
    {
      id: 'prompts-list-cli',
      surface: 'cli',
      syntax: 'prompts list [--search TEXT] [--tag TAG] [--cwd FOLDER]',
      label: UI_TEXT.promptLibrary,
      detail: UI_TEXT.promptScopeUser,
    },
    {
      id: 'prompts-use-cli',
      surface: 'cli',
      syntax: 'prompts use ID [--scope user|workspace] [--chat active|new] [--cwd FOLDER]',
      label: UI_TEXT.promptUseSaved,
      detail: UI_TEXT.promptRun,
    },
    {
      id: 'prompts-share-cli',
      surface: 'cli',
      syntax:
        'prompts share ID [--scope user|workspace] [--format md|html|json] [--destination copy|file|browser] [--out FILE]',
      label: UI_TEXT.sharePrompt,
      detail: UI_TEXT.shareConfirm,
    },
  ]
}

export function sharingHelp(): string {
  return sharingFeatures()
    .map((feature) => `${feature.syntax}\n${feature.label}: ${feature.detail}`)
    .join('\n\n')
}
