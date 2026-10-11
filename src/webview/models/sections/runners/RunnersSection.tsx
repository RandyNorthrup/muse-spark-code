import { useState } from 'react'
import { fill, formatNumber, UI_TEXT } from '../../../../shared/l10n/text'
import { type RunnersMessage, type RunnersSlice } from '../../../../shared/modelsPanel'
import { type Runner } from '../../../../shared/team'
import { RunnerForm } from './RunnerForm'
import '../../../components/traffic/traffic.css'

/** Registered by the Models & Agents section registry after M95 lands. */
export function RunnersSection({
  state,
  postMessage,
}: {
  state: RunnersSlice
  postMessage: (message: RunnersMessage) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [runner, setRunner] = useState<Runner>()
  return (
    <section className="traffic-view" aria-label={UI_TEXT.teamRunners.title}>
      <h2>{UI_TEXT.teamRunners.title}</h2>
      <p>{UI_TEXT.teamRunners.trustNotice}</p>
      <div className="traffic-actions">
        <button
          type="button"
          onClick={() => {
            setRunner(undefined)
            setIsEditing(true)
          }}
        >
          {UI_TEXT.teamRunners.add}
        </button>
        <button
          type="button"
          disabled={!state.trusted}
          onClick={() => {
            postMessage({ type: 'runners/testAll' })
          }}
        >
          {UI_TEXT.teamRunners.testAll}
        </button>
      </div>
      {isEditing && (
        <RunnerForm
          key={runner?.id ?? 'new'}
          runner={runner}
          onSave={(value) => {
            postMessage({ type: 'runners/save', runner: value })
            setIsEditing(false)
          }}
          onCancel={() => {
            setIsEditing(false)
          }}
        />
      )}
      <ul className="traffic-list">
        {state.runners.map((item) => {
          const health = state.health.find((row) => row.id === item.id)
          return (
            <li key={item.id}>
              <strong>{item.id}</strong>
              <p>
                {UI_TEXT.teamRunners.destination}: <code>{item.destination}</code>
              </p>
              <p>
                {UI_TEXT.teamRunners.os}: {item.os} · {UI_TEXT.teamRunners.maxJobs}:{' '}
                {formatNumber(item.maxJobs)}
              </p>
              <p>
                {UI_TEXT.teamRunners.workFolder}: <code>{item.workFolder}</code>
              </p>
              <p>
                {UI_TEXT.teamRunners.labels}: {item.labels.join(', ')}
              </p>
              <p>
                {UI_TEXT.teamRunners.commandClasses}:{' '}
                {item.commandClasses.map((value) => UI_TEXT.teamRunners[value]).join(', ')}
              </p>
              {health && (
                <>
                  <p>{UI_TEXT.teamRunners[health.state]}</p>
                  {health.detail && <p>{health.detail}</p>}
                  {health.fingerprint && (
                    <p>
                      {fill(UI_TEXT.teamRunners.hostKeyNotice, { fingerprint: health.fingerprint })}
                    </p>
                  )}
                  {health.inputHang && <p>{UI_TEXT.teamRunners.inputHangNotice}</p>}
                </>
              )}
              <div className="traffic-actions">
                <button
                  type="button"
                  disabled={!state.trusted}
                  onClick={() => {
                    postMessage({ type: 'runners/test', runnerId: item.id })
                  }}
                >
                  {UI_TEXT.teamRunners.test}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRunner(item)
                    setIsEditing(true)
                  }}
                >
                  {UI_TEXT.goalEdit}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    postMessage({ type: 'runners/remove', runnerId: item.id })
                  }}
                >
                  {UI_TEXT.teamTraffic.remove}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
