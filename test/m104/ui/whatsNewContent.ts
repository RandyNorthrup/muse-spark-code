import { COMMAND_IDS } from '../../../src/shared/constants'

export const whatsNewFixtureContent = JSON.stringify({
  schema: 1,
  releases: [
    {
      version: '0.14.3',
      date: '2026-10-06',
      highlights: [
        {
          c: [
            {
              t: 'p',
              c: [
                { t: 'text', v: '<script>escaped</script>' },
                { t: 'link', href: 'https://example.com/notes', c: [{ t: 'text', v: 'Notes' }] },
              ],
            },
          ],
          tries: [
            { kind: 'command', id: COMMAND_IDS.openInNewTab },
            { kind: 'command', id: 'forged.command' },
            { kind: 'setting', id: 'museSpark.autosave' },
          ],
        },
      ],
      sections: [],
    },
  ],
})
