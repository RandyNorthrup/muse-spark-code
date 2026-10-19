// One session goal (M45, PLAN.md D38) as Muse Code's goal tools return it
// and as a stored session keeps it (D14). Apart from goals.ts, the goal
// tools and verbs, so the stored-session format, which the activation
// bundle's session store reads, does not carry them into dist/extension.js
// (M57, PLAN.md D6).

import * as z from 'zod/mini'

/**
One goal, as Muse Code's tools return it (`{ goal: { … } }`, snake case,
`null` for what is not set) without its `session_id`; stored with the
session as it is (D14).
*/
export const goalRecordSchema = z.object({
  goal_id: z.string(),
  objective: z.string(),
  status: z.string(),
  percent_complete: z.number(),
  current_work: z.nullable(z.string()),
  next_work: z.nullable(z.string()),
  token_budget: z.nullable(z.number()),
  tokens_used: z.number(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
  last_progress_at_ms: z.nullable(z.number()),
})
export type GoalRecord = z.infer<typeof goalRecordSchema>
