import { createRoot } from 'react-dom/client'
import { VaultSurface } from '../../../src/webview/models/sections/vault/VaultSurface'
import { type VaultPanelState } from '../../../src/shared/modelsPanel'
import { type VaultUse } from '../../../src/shared/vault'
import { VAULT_APPROVAL_TTL_MS } from '../../../src/shared/constants'

const id = () => crypto.randomUUID().replaceAll('-', '')
const command = {
  executable: '/usr/bin/tool',
  argv: ['--check', '--destination', 'outside.test'],
  cwd: '/workspace',
}
const origin = 'https://login.test'
const fingerprint = 'SHA256:' + 'A'.repeat(43)
const browserId = id()
const uses: VaultUse[] = [
  {
    kind: 'ssh',
    host: 'deploy.test',
    hostKeyFingerprint: fingerprint,
    remoteUser: 'deploy',
    sessionId: 'YQ==',
    forwarding: false,
  },
  { kind: 'sshSign', keyFingerprint: fingerprint, namespace: 'git', dataDigest: 'f'.repeat(64) },
  { kind: 'sudo', command, sudoPath: '/usr/bin/sudo' },
  { kind: 'askpass', command, sudoPath: '/usr/bin/sudo' },
  { kind: 'git', command, protocol: 'https', host: 'git.test', path: 'project' },
  { kind: 'environment', command, names: ['SERVICE_TOKEN'] },
  { kind: 'stdin', command },
  { kind: 'totp', command },
  { kind: 'mcp', command, server: 'server', names: ['SERVICE_TOKEN'] },
  { kind: 'header', origin, headerName: 'Authorization' },
  { kind: 'oauth', origin, issuer: 'https://issuer.test/path/', resource: origin + '/resource' },
  {
    kind: 'fill',
    origin,
    topOrigin: origin,
    frameOrigin: origin,
    frameId: 'frame',
    browserId,
    certificateValid: true,
    field: 'password',
  },
  { kind: 'session', origin, browserId },
  { kind: 'disclosure', recipient: 'person' },
]
const query = new URLSearchParams(location.search)
const scenario = query.get('scenario') ?? 'panel'
const now = Date.now()
const requester = {
  id: id(),
  hostId: id(),
  conversationId: 'conversation',
  taskId: 'task',
  role: { kind: 'orchestrator' as const },
  workspaceId: 'trusted-workspace',
  deviceId: null,
  peerProcessId: 100,
  sessionId: id(),
  unattended: false,
  source: 'conversation' as const,
}
const item = {
  id: id(),
  name: 'deploy',
  handle: 'secret://deploy',
  label: 'Deployment credential',
  kind: 'secret' as const,
  bindings: [
    { kind: 'environment' as const, commandDigest: 'f'.repeat(64), names: ['SERVICE_TOKEN'] },
  ],
  requirePresence: true,
  hidden: false,
  firstParty: false,
  policy: { mode: 'askOncePerSession' as const, unattendedAllowed: false, allowDisclosure: true },
  dates: { createdAt: now, rotatedAt: null, expiresAt: null, lastUsedAt: now },
  publicKey: null,
  fingerprint: null,
}
const grant = {
  id: id(),
  itemId: item.id,
  roles: [requester.role],
  workspaces: ['trusted-workspace'],
  target: item.bindings[0]!,
  maxUses: 2,
  uses: 1,
  expiresAt: now + VAULT_APPROVAL_TTL_MS,
  window: { days: [1, 2], startHour: 9, endHour: 17 },
  unattendedAllowed: false,
  sessionId: requester.sessionId,
  taskId: 'task',
  ceiling: [item.handle],
  createdAt: now,
  createdBy: 'vaultPanel' as const,
}
const selected = uses.find(
  (use) => use.kind === (scenario === 'allow-session' ? 'header' : scenario),
)
const state: VaultPanelState = {
  status: {
    state: scenario === 'locked' ? 'locked' : 'unlocked',
    lockEpoch: 1,
    tier: 'osStore',
    provider: 'loginKeychain',
    silentUnlock: true,
    itemCount: 1,
    reason: null,
  },
  items: scenario === 'empty' ? [] : [item],
  grants: scenario === 'empty' ? [] : [grant],
  audit: [
    {
      v: 1,
      id: id(),
      generation: 1,
      time: now,
      requester,
      handle: item.handle,
      kind: 'environment',
      target: '/usr/bin/tool --check',
      digest: 'a'.repeat(64),
      decision: 'allow',
      authority: 'user',
      grantId: null,
      outcome: 'succeeded',
      previousHash: '0'.repeat(64),
      hash: '1'.repeat(64),
      mac: '2'.repeat(64),
    },
  ],
  pending:
    selected === undefined
      ? []
      : [
          {
            id: id(),
            requester,
            item,
            use: selected,
            digest: 'a'.repeat(64),
            nonce: id(),
            createdAt: now,
            expiresAt: now + VAULT_APPROVAL_TTL_MS,
            lockEpoch: 1,
            taint:
              scenario === 'allow-session'
                ? { tainted: false, reasons: [] }
                : { tainted: true, reasons: [{ source: 'web', label: 'Outside page' }] },
          },
        ],
  notices: scenario === 'platform-notices' ? ['nopasswd', 'fenceOff', 'seUnavailable'] : [],
  ambientFiles: [{ path: '/home/example/.netrc', kind: 'netrc' }],
}
const root = document.querySelector('#root')
if (root === null) throw new Error('missing harness root')
createRoot(root).render(
  <VaultSurface
    raw={{ type: 'vaultState', state }}
    post={() => {
      /* Test host has no secret values. */
    }}
    onManage={() => {
      /* Test-only surface. */
    }}
    cardsOnly={selected !== undefined}
  />,
)
