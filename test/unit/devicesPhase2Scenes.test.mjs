// The Devices harness scenes' own fixture logic, run in a bare VM context:
// no browser, no production build. The scenes' initial states omit action
// facts, replies are correlated and valid, and peer-bound scenes start with
// a peer-bound action.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parseDeviceHostMessage } from '../../src/shared/devicesPanel'

const SCENES = [
  'devices-qr',
  'devices-discovery',
  'devices-owners',
  'devices-prompts-narrow',
  'devices-power',
  'devices-blocked',
]
const html = readFileSync('test/harness/index.html', 'utf8')
const fixtures = html.slice(
  html.indexOf('const deviceId ='),
  html.indexOf('// M25: the conversation'),
)
const sceneSteps = html.slice(
  html.indexOf('const deviceScenes ='),
  html.indexOf(
    "for (const name of [\n        'questions-waiting'",
    html.indexOf('const deviceScenes ='),
  ),
)

describe('Devices harness scene fixtures', () => {
  it.each(SCENES)(
    '%s initial state omits action facts; reply is correlated and valid',
    (scenarioName) => {
      const sent = []
      runInNewContext(
        `${fixtures}
send(deviceFixture(scenarioName));
deviceReply({ viewId: '1'.repeat(32), requestId: '2'.repeat(32), action: { kind: 'pauseOffers' } });`,
        {
          scenarioName,
          send: (message) => {
            sent.push(message)
          },
        },
      )
      expect(sent[0].setup).toBeUndefined()
      expect(parseDeviceHostMessage(sent[0]).ok).toBe(true)
      expect(parseDeviceHostMessage(sent[1]).ok).toBe(true)
      expect(sent[1].setup.viewId).toBe('1'.repeat(32))
      expect(sent[1].setup.requestId).toBe('2'.repeat(32))
    },
  )

  it('owners reply has no alert before revoke and a revoke-specific refusal afterwards', () => {
    const sent = []
    runInNewContext(
      `${fixtures}
    deviceReply({ viewId: '1'.repeat(32), requestId: '2'.repeat(32), action: { kind: 'pauseOffers' } });
    deviceReply({ viewId: '1'.repeat(32), requestId: '3'.repeat(32), action: { kind: 'revokeGrant', ownerId: 'a'.repeat(32) } });`,
      {
        scenarioName: 'devices-owners',
        send: (message) => {
          sent.push(message)
        },
      },
    )
    expect(sent[0].setup.owners).toHaveLength(1)
    expect(sent[0].setup.grantRefusal).toBeUndefined()
    expect(sent[1].setup.grantRefusal.reason).toBe('grant-revoked')
    expect(parseDeviceHostMessage(sent[1]).ok).toBe(true)
  })

  it.each(['devices-owners', 'devices-prompts-narrow'])(
    '%s starts with a peer-bound action',
    (name) => {
      const clicked = []
      const steps = {}
      runInNewContext(`${fixtures}\n${sceneSteps}\nsteps[name]();`, {
        name,
        steps,
        scenarioName: name,
        send: () => undefined,
        whenFound: (selector, run) => {
          if (selector === '.device-card') run()
        },
        document: {
          querySelector: (selector) => ({
            click: () => {
              clicked.push(selector)
            },
          }),
        },
      })
      expect(clicked).toEqual(['.device-actions button:first-child'])
    },
  )
})
