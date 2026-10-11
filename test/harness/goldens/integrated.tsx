import { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { EN } from '../../../src/shared/l10n/en'
import { setUiText } from '../../../src/shared/l10n/text'
import { CompanionMedia } from '../../../src/webview/media/entry'
import { ToolVideo } from '../../../src/webview/media/toolEntry'
import { CompanionRecorder } from '../../../src/webview/media/recorder/CompanionRecorder'
import { AttachmentSound } from '../../../src/webview/components/AttachmentSound'
import { AttachmentMediaCost } from '../../../src/webview/components/AttachmentMediaCost'
import { SetupBanner } from '../../../src/webview/components/SetupBanner'
import { ToolArgumentPreview } from '../../../src/webview/components/ToolArgumentPreview'
import { DeveloperOptionsPage } from '../../../src/webview/developer/DeveloperOptionsPage'
import AccountsSection from '../../../src/webview/usage/AccountsSection'
import { usageFixture } from '../../unit/helpers/accounts/usage'
import UsageReportAction from '../../../src/webview/reporting/UsageReportAction'
import { DestinationPicker } from '../../../src/webview/reporting/destinations/DestinationPicker'
import { DeferredReportActionEditor } from '../../../src/webview/schedules/DeferredReportActionEditor'
import { draftOf } from '../../../src/webview/schedules/ScheduleEditor'
import { fakeSchedule } from '../../unit/helpers/schedules/fixtures'
import type { BrowserRecordingPort } from '../../../src/webview/media/recorder/browserRecorder'
import type { BrowserRecorderPort } from '../../../src/webview/media/recordingPort'
import type { MediaUploadPort } from '../../../src/webview/media/transport'
import type { AudioRouteOptions } from '../../../src/shared/audioRouting'
import type { ReportingWebviewMessage } from '../../../src/webview/reporting/protocol'
import { createTrafficView } from '../../../src/webview/components/traffic/TrafficView'
import { trafficFixture } from '../../unit/helpers/trafficFixtures'
import { MirroredColumns } from '../../../src/webview/usage/charts/MirroredColumns'
import { ModelDetail } from '../../../src/webview/usage/ModelDetail'
import { usageStateFor } from '../../unit/helpers/usageFixtures'
import { SavingsSection } from '../../../src/webview/usage/SavingsSection'
import { AttemptsSection } from '../../../src/webview/usage/AttemptsSection'
import { BreakdownTable } from '../../../src/webview/usage/BreakdownTable'
import { FeaturesTable } from '../../../src/webview/usage/FeaturesTable'
import { LimitsSection } from '../../../src/webview/usage/LimitsSection'
import { StackedColumns } from '../../../src/webview/usage/charts/StackedColumns'
import { ShareBar } from '../../../src/webview/usage/charts/ShareBar'
import { StepLines } from '../../../src/webview/usage/charts/StepLines'
import { BurnLine } from '../../../src/webview/usage/charts/BurnLine'
import '../../../src/webview/usage/usage.css'
import { PlaybookMap } from '../../../src/webview/playbook/PlaybookMap'
import { surfacePort, surfaceSnapshot } from '../../unit/playbookSurfaceFixtures'

const noop = () => undefined
const TrafficView = createTrafficView(
  async () => await import('../../../src/webview/components/traffic/TrafficSurface'),
)
const unavailable = () => Promise.reject(new Error('Capture fixture cannot record or upload'))
const recordingPort: BrowserRecordingPort = {
  browser: 'Chrome fixture',
  supportsMp4: () => false,
  capture: unavailable,
  objectUrl: () => {
    throw new Error('Capture fixture has no recording')
  },
  revokeUrl: noop,
  attach: unavailable,
}
const recorder: BrowserRecorderPort = {
  available: () => ({ ok: false, reason: 'No recording in visual fixture' }),
  start: unavailable,
}
const transport: MediaUploadPort = { upload: unavailable }
const options: AudioRouteOptions = {
  actions: ['sendAudio', 'transcribe'],
  defaultAction: 'sendAudio',
  labels: {
    sendAudio: 'Send audio',
    transcribe: 'Transcribe',
    useSoundtrackModel: 'Soundtrack',
    sendWithoutSound: 'No audio',
    wrapAsVideo: 'Wrap as video',
  },
}
const destinations = [
  {
    type: 'save' as const,
    id: 'save',
    root: 'reports',
    storage: 'local' as const,
    template: '{kind}-{date}.{ext}',
    retention: 30,
  },
]
const scene = new URLSearchParams(location.search).get('scene')
const usageState = usageStateFor('one-provider')
setUiText(EN, 'en')
const element = document.querySelector('#root')
if (element === null) throw new Error('Missing integrated fixture root')

function Picker() {
  return (
    <DestinationPicker
      destinations={destinations}
      choices={destinations}
      format="md"
      connections={[]}
      verifiedRecipients={[]}
      connectableProviders={[]}
      onChange={noop}
      onFormat={noop}
      onPickFolder={noop}
      onConnect={noop}
      onVerify={noop}
    />
  )
}

if (scene === 'reporting-page') {
  // Exercise the independent shipping bootstrap and its validated fake host.
  Object.defineProperty(globalThis, 'acquireVsCodeApi', {
    configurable: true,
    value: () => ({
      postMessage: (message: ReportingWebviewMessage) => {
        if (message.type === 'reportingReady')
          window.dispatchEvent(
            new MessageEvent('message', {
              data: {
                type: 'reportingState',
                busy: false,
                header: null,
                html: '',
                history: [],
                diff: null,
                status: 'No retained reports',
                isError: false,
              },
            }),
          )
      },
      getState: () => null,
      setState: noop,
    }),
  })
  void import('../../../src/webview/reporting/main')
} else {
  let content
  switch (scene) {
    case 'media-controls': {
      content = (
        <Suspense fallback={<p role="status">Loading media controls</p>}>
          <CompanionMedia
            attachmentEpoch={0}
            transport={transport}
            recorder={recorder}
            onAttached={noop}
          />
          <CompanionRecorder port={recordingPort} />
          <div className="visual-audio">
            <AttachmentSound
              attachment={{
                id: 'audio',
                name: 'sample.wav',
                mediaType: 'audio/wav',
                sizeBytes: 100,
              }}
              options={options}
              onAction={noop}
            />
          </div>
          <AttachmentMediaCost
            media={{
              info: { kind: 'audio', mediaType: 'audio/wav', sizeBytes: 100, durationSeconds: 2 },
            }}
            isContributor={false}
          />
          <div className="visual-video">
            <ToolVideo
              path="unavailable.mp4"
              resources={{ resolve: unavailable, isAllowed: () => false }}
            />
          </div>
        </Suspense>
      )
      break
    }
    case 'developer-options': {
      content = (
        <DeveloperOptionsPage
          message={{
            type: 'developer/state',
            isUnlocked: true,
            isMultipleAccountsOn: true,
            expiresAt: null,
            profiles: [{ id: 'profile-one', provider: 'meta', account: 'work' }],
          }}
          post={noop}
        />
      )
      break
    }
    case 'account-usage': {
      content = <AccountsSection report={usageFixture().report()} />
      break
    }
    case 'report-destinations': {
      content = (
        <>
          <Picker />
          <UsageReportAction onUsageReport={noop} />
        </>
      )
      break
    }
    case 'schedule-report-action': {
      const value = draftOf(
        fakeSchedule({
          action: {
            kind: 'report',
            reportKind: 'usage',
            args: {},
            format: 'markdown',
            destinations: [
              { id: 'browser', kind: 'browser', location: 'local', whenInactive: 'wait' },
            ],
          },
        }),
      )
      content = (
        <DeferredReportActionEditor
          value={value}
          initialPrompt="Review build output"
          kinds={[{ id: 'usage', label: 'Usage', capability: { available: true }, arguments: [] }]}
          DestinationPicker={Picker}
          onChange={noop}
        />
      )
      break
    }
    case 'setup-preview': {
      content = (
        <>
          <SetupBanner
            provider="Local provider"
            model="Coding model"
            onManageProviders={noop}
            onDismiss={noop}
          />
          <ToolArgumentPreview
            preview={{ text: '{"path":"src/index.ts"}', bytes: 23, truncated: false, frozen: true }}
          />
        </>
      )
      break
    }
    case 'usage-tokens': {
      content = (
        <MirroredColumns
          state={{
            ...usageStateFor('nine-providers'),
            query: { ...usageStateFor('nine-providers').query, metric: 'tokens' },
          }}
        />
      )
      break
    }
    case 'usage-detail': {
      const state = usageStateFor('nine-providers')
      content = (
        <ModelDetail
          state={{
            ...state,
            modelDetail: {
              provider: 'meta',
              model: 'Muse Spark',
              totals: state.totals,
              trend: state.buckets,
              pricedLater: false,
            },
          }}
          post={noop}
          onClose={noop}
        />
      )
      break
    }
    case 'playbook-map': {
      content = (
        <PlaybookMap port={surfacePort(surfaceSnapshot())}>
          <p>Agent map</p>
        </PlaybookMap>
      )
      break
    }
    case 'usage-savings': {
      content = <SavingsSection savings={usageState.savings} />
      break
    }
    case 'usage-attempts': {
      content = <AttemptsSection attempts={usageState.attempts} />
      break
    }
    case 'usage-breakdown': {
      content = <BreakdownTable rows={usageState.breakdown} post={noop} />
      break
    }
    case 'usage-features': {
      content = <FeaturesTable features={usageState.features} />
      break
    }
    case 'usage-stacked': {
      content = <StackedColumns state={usageState} />
      break
    }
    case 'usage-share': {
      content = <ShareBar state={usageState} />
      break
    }
    case 'usage-steps': {
      content = <StepLines snapshots={usageState.limits} />
      break
    }
    case 'usage-limits': {
      content = <LimitsSection state={usageState} post={noop} now={() => usageState.generatedAt} />
      break
    }
    case 'usage-burn': {
      const budget = usageState.budgets[0]
      if (budget === undefined) throw new Error('Missing visual budget')
      content = <BurnLine budget={budget} now={usageState.generatedAt} />
      break
    }
    default: {
      if (scene?.startsWith('traffic-'))
        content = <TrafficView mode="team" state={trafficFixture()} postMessage={noop} />
      else throw new Error(`Unknown integrated visual scene: ${String(scene)}`)
    }
  }
  createRoot(element).render(
    scene.startsWith('usage-') ? <main className="usage-page">{content}</main> : content,
  )
}
