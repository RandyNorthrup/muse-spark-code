// M10/D13: a trusted workspace's rules reach the model.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/modelApi.live.e2e.test.ts, `live Model API sweep > case17
//   workspace context: the rules file and a project skill (D13, M10)`
//   (the rules half; project skills ride the same loader and are covered
//   by the same run path)
//
// The first session writes the rules file; a NEW session then answers under
// it, so the word it must begin with could only have come from the file.
// The editor starts trusted, as an editor with a trusted workspace does;
// headless runs refuse trust (see m80-exec-args), so this is ACP only.
//
// Expected model attempts: 4. Dollar cap: $0.10.
export default {
  title: 'A trusted workspace rule is followed by a new session',
  acp: {
    claims: ['ref/feature/workspace-context', 'ref/feature/acp'],
    requests: 4,
    maxUsd: '0.10',
    async run(person, see) {
      const marker = person.marker()
      const editor = await person.openEditor(['--trust-workspace'])
      const staging = await editor.newSession()
      const written = await staging.prompt(
        `Write the file AGENTS.md in the workspace with your file tool whose whole content ` +
          `is exactly this single line, then reply with the one word DONE: ` +
          `Always begin every reply with the word ${marker}.`,
        { permissions: 'allow' },
      )
      see('the staging turn completed', written.stopReason === 'end_turn', written.stopReason)
      see(
        'the rules file is on disk with the instruction',
        person.file('AGENTS.md')?.includes(marker) === true,
        person.file('AGENTS.md') ?? 'no such file',
      )
      const session = await editor.newSession()
      const hello = await session.prompt('Say hello in one sentence.')
      see('the new session answers', hello.stopReason === 'end_turn', hello.stopReason)
      see(
        'its reply begins with the word only the rules file holds',
        hello.said.trim().startsWith(marker),
        hello.said,
      )
    },
  },
}
