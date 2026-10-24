// D107 (M125 lane W): the Set Up Local Judge wizard. The host owns
// the machine: this renders each snapshot's step and posts its
// commands. The footer offers exactly the step's legal commands, so
// the surface never sends one the controller would refuse; Advanced
// holds the recommendation's choices. Everything reads UI_TEXT when
// it renders, never at module load.
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { setupLegalCommands } from '../../shared/judgeSetup'
import type {
  JudgeSetupCommand,
  JudgeSetupCommandMessage,
  JudgeSetupSnapshot,
} from '../../shared/judgeSetupSchema'
import {
  parseJudgeSetupHostToPanel,
  type JudgeSetupPanelToHost,
} from '../../shared/judgeSetupPanel'
import type { ErrorReporter } from '../errorReport'
import type { HostBridge } from '../hostBridge'
import { DoneStep, InstallStep, LicenceStep, RecommendationStep, ScanStep } from './steps'

export interface JudgeSetupAppProps {
  readonly host: HostBridge
  readonly report: ErrorReporter
}

/** The footer button for a legal chrome command; Advanced owns the rest. */
function ChromeButton({
  command,
  snapshot,
  post,
}: {
  readonly command: JudgeSetupCommand
  readonly snapshot: JudgeSetupSnapshot
  readonly post: (message: JudgeSetupCommandMessage) => void
}) {
  const text = UI_TEXT.judgeSetupWizard
  switch (command) {
    case 'startScan': {
      if (snapshot.step !== 'scan' || snapshot.running) return null
      return (
        <button
          type="button"
          className="models-button-primary"
          onClick={() => {
            post({ command: 'startScan' })
          }}
        >
          {snapshot.error === undefined && snapshot.summary.length === 0
            ? text.scanStart
            : text.scanAgain}
        </button>
      )
    }
    case 'startInstall': {
      if (snapshot.step === 'recommendation' && snapshot.model !== undefined) {
        return (
          <button
            type="button"
            className="models-button-primary"
            onClick={() => {
              post({ command: 'startInstall' })
            }}
          >
            {text.install}
          </button>
        )
      }
      if (snapshot.step === 'install' && snapshot.error !== undefined) {
        return (
          <button
            type="button"
            className="models-button-primary"
            onClick={() => {
              post({ command: 'startInstall' })
            }}
          >
            {text.tryAgain}
          </button>
        )
      }
      return null
    }
    case 'acceptLicence': {
      return (
        <button
          type="button"
          className="models-button-primary"
          onClick={() => {
            post({ command: 'acceptLicence' })
          }}
        >
          {text.acceptLicence}
        </button>
      )
    }
    case 'back': {
      return (
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ command: 'back' })
          }}
        >
          {UI_TEXT.wizardBack}
        </button>
      )
    }
    case 'cancel': {
      return (
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ command: 'cancel' })
          }}
        >
          {snapshot.step === 'done' ? text.close : UI_TEXT.wizardCancel}
        </button>
      )
    }
    case 'setUpLater': {
      return (
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ command: 'setUpLater' })
          }}
        >
          {text.setUpLater}
        </button>
      )
    }
    default: {
      return null
    }
  }
}

export function JudgeSetupApp({ host, report }: JudgeSetupAppProps) {
  const [snapshot, setSnapshot] = useState<JudgeSetupSnapshot | undefined>(undefined)
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const parsed = parseJudgeSetupHostToPanel(event.data)
      if (!parsed.ok) {
        report('hostMessage', new Error(parsed.error))
        return
      }
      const message = parsed.message
      // A close disposes the panel on the host; the last snapshot stays
      // painted behind it, with nothing left to wait for.
      if (message.type === 'judgeSetup/snapshot') setSnapshot(message.snapshot)
    }
    host.messages.addEventListener('message', onMessage)
    // Subscribe before ready: the host may reply in the same task.
    host.post({ type: 'judgeSetup/ready' })
    return () => {
      host.messages.removeEventListener('message', onMessage)
    }
  }, [host, report])
  const text = UI_TEXT.judgeSetupWizard
  if (snapshot === undefined) {
    return (
      <div className="js-panel">
        <h2>{text.title}</h2>
        <p role="status">{UI_TEXT.loadingOutput}</p>
      </div>
    )
  }
  const postCommand = (message: JudgeSetupCommandMessage): void => {
    const outgoing: JudgeSetupPanelToHost = { type: 'judgeSetup/command', message }
    host.post(outgoing)
  }
  const openExternal = (url: string): void => {
    host.post({ type: 'judgeSetup/openExternal', url })
  }
  const legal = setupLegalCommands(snapshot)
  return (
    <div className="js-panel">
      <h2>{text.title}</h2>
      {snapshot.step === 'scan' && <ScanStep snapshot={snapshot} />}
      {snapshot.step === 'recommendation' && (
        <RecommendationStep snapshot={snapshot} post={postCommand} />
      )}
      {snapshot.step === 'licence' && (
        <LicenceStep snapshot={snapshot} openExternal={openExternal} />
      )}
      {snapshot.step === 'install' && <InstallStep snapshot={snapshot} />}
      {snapshot.step === 'done' && <DoneStep snapshot={snapshot} />}
      <div className="js-row-actions">
        {legal.map((command) => (
          <ChromeButton key={command} command={command} snapshot={snapshot} post={postCommand} />
        ))}
      </div>
    </div>
  )
}
