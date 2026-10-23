// M125 lane H (D107 §8.1 step 3): the 2j registration record. The
// endpoint, model id and digest, runtime path, loaded context window
// and timeout, with the install fingerprint that shows Re-scan when
// the machine changes. The host's 2j assembly reads this file; a
// missing or corrupt record reads as not registered, never half.
import { readFileSync, writeFileSync } from 'node:fs'
import * as z from 'zod/mini'

const recordSchema = z.strictObject({
  version: z.literal(1),
  endpoint: z.string().check(z.minLength(1)),
  model: z.string().check(z.minLength(1)),
  digest: z.string().check(z.regex(/^[a-f\d]{64}$/)),
  runtimePath: z.string().check(z.minLength(1)),
  modelsDir: z.string().check(z.minLength(1)),
  contextWindow: z.int().check(z.positive()),
  timeoutMs: z.int().check(z.positive()),
  fingerprint: z.string().check(z.minLength(1)),
  registeredAt: z.string().check(z.minLength(1)),
})

export type JudgeSetupRecord = z.infer<typeof recordSchema>

/** Write the registration; a write failure fails setup loudly. */
export function writeJudgeRegistration(file: string, record: JudgeSetupRecord): void {
  writeFileSync(file, `${JSON.stringify(record, undefined, 2)}\n`, 'utf8')
}

/** Read the registration, or undefined when missing or corrupt. */
export function readJudgeRegistration(file: string): JudgeSetupRecord | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw new Error(`unreadable judge registration: ${file}`, { cause: error })
  }
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const parsed = recordSchema.safeParse(input)
  return parsed.success ? parsed.data : undefined
}
