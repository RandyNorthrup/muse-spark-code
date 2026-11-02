// M106: a headless run answers in the caller's schema, validated.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/unit/execOutput.test.ts, the M106 structured-exec-egress rows
//   (validated output with its exact digest; a mismatched final answer
//   refused; decoded sensitive fields redacted before validation)
// - test/unit/structuredOutput.test.ts, the side-answer rows (only supported
//   evidence selected; a valid repair used without a third request; terminal
//   admission failures propagated without repair)
// - test/unit/outputSchema.test.ts, `M106 O2 strict output schema > ships
//   additive v1 schema snapshots preserving every base field and event guard`
//
// The schema uses only the file format's own keys (type, properties,
// required, additionalProperties: false); anything else the reader refuses.
//
// Expected model attempts: 6. Dollar cap: $0.10.
const SCHEMA = 'answer.schema.json'
const SCHEMA_TEXT =
  '{"type":"object","properties":{"word":{"type":"string"}},"required":["word"],"additionalProperties":false}'

export default {
  title: 'exec --output-schema answers validated JSON',
  exec: {
    claims: ['ref/cli/exec/exec---output-schema-value', 'ref/feature/structured-output'],
    requests: 6,
    maxUsd: '0.10',
    async run(person, see) {
      const marker = person.marker()
      const staged = await person.exec(
        `Write the file ${SCHEMA} with your file tool whose whole content is exactly this, ` +
          `byte for byte, then reply with the one word DONE: ${SCHEMA_TEXT}`,
        { mode: 'acceptEdits', maxRequests: 2 },
      )
      see('the staging turn completed', staged.code === 0, `exit ${String(staged.code)}`)
      see(
        'the schema file holds the schema',
        person.file(SCHEMA)?.includes('"word"') === true,
        person.file(SCHEMA) ?? 'no such file',
      )
      const turn = await person.exec(`Reply with {"word": "${marker}"}.`, {
        maxRequests: 4,
        args: ['--output-schema', SCHEMA],
      })
      see(
        'the structured turn completed',
        turn.code === 0,
        `exit ${String(turn.code)}, status ${String(turn.result?.status)}`,
      )
      let parsed
      try {
        parsed = JSON.parse(turn.result?.finalMessage ?? '')
      } catch {
        parsed = undefined
      }
      see(
        'the answer parses as JSON with the schema key',
        typeof parsed?.word === 'string',
        turn.result?.finalMessage ?? turn.result?.error?.message ?? turn.stderr,
      )
      see(
        'the schema value carries the word asked for',
        parsed?.word?.includes(marker) === true,
        typeof parsed?.word === 'string' ? parsed.word : '(no word)',
      )
    },
  },
}
