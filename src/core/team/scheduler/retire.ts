import { type TeamAttempt } from '../../../shared/team'

export type RetirementOutcome =
  | { state: 'retired'; endedAt: number; retirement: NonNullable<TeamAttempt['retirement']> }
  | { state: 'uncertain'; reason: string }
