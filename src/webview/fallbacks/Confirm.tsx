import { UI_TEXT } from '../../shared/l10n/text'
import type { MhpParams, MhpResult } from '../../shared/hostApi/methods'
import { Dialog } from './Dialog'

export function Confirm({
  params,
  onResult,
}: {
  readonly params: MhpParams<'ui/confirm'>
  readonly onResult: (result: MhpResult<'ui/confirm'>) => void
}) {
  return (
    <Dialog
      title={params.title}
      onCancel={() => {
        onResult(null)
      }}
    >
      <p className="fallback-text">{params.message}</p>
      <div className="fallback-actions">
        {params.choices.map((choice) => (
          <button
            type="button"
            key={JSON.stringify(choice.id)}
            onClick={() => {
              onResult(choice.id)
            }}
          >
            {choice.title}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            onResult(null)
          }}
        >
          {UI_TEXT.goalEditCancel}
        </button>
      </div>
    </Dialog>
  )
}
