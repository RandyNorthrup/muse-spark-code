import type { WorkerPromptParts } from '../../../src/core/team/workers/workerTypes'

/** Shared charter fixture for both the recording ACP port and real stdio tests. */
export const TEAM_WORKER_PROMPT: WorkerPromptParts = {
  charter: 'You are the engineering worker.',
  body: 'Write clean code.',
  rulesAndSkills: 'Follow the repo rules.',
}
