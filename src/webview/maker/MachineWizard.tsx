import { type ReactNode, useState } from 'react'
import { MAKER_PROTOCOL_VERSION, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { makerSurfaceMessageSchema, type MakerSurfaceMessage } from '../../shared/makerProtocol'
import { Modal } from '../components/Modal'

const KINDS = ['moonraker', 'octoprint', 'prusalink', 'grbl', 'fluidnc', 'marlin']
const CATEGORIES = ['printer', 'cnc', 'laser', 'robot']
const AXES = ['x', 'y', 'z']

/** Secret input is the host's credential UI; this wizard sends no key field. */
export function MachineWizard({
  send,
  onClose,
  stop,
}: {
  readonly stop: ReactNode
  readonly send: (message: MakerSurfaceMessage) => boolean
  readonly onClose: () => void
}) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [kind, setKind] = useState(KINDS[0] ?? '')
  const [category, setCategory] = useState(CATEGORIES[0] ?? '')
  const [endpoint, setEndpoint] = useState('')
  const [plainHttp, setPlainHttp] = useState(false)
  const [limits, setLimits] = useState<Record<string, string>>({})
  const [invalid, setInvalid] = useState(false)
  const isPlainHttp = endpoint.trim().toLowerCase().startsWith('http:')
  const limitNumber = (key: string) => (limits[key]?.trim() ? Number(limits[key]) : undefined)
  const isTravelEntered = AXES.some(
    (axis) => limitNumber(`min.${axis}`) !== undefined || limitNumber(`max.${axis}`) !== undefined,
  )
  const submit = () => {
    const parsed = makerSurfaceMessageSchema.safeParse({
      v: MAKER_PROTOCOL_VERSION,
      type: 'makerAddMachine',
      allowPlainHttp: isPlainHttp && plainHttp,
      machine: {
        id: id.trim(),
        name: name.trim(),
        kind,
        category,
        endpoint: endpoint.trim(),
        limits: {
          ...(isTravelEntered && {
            travel: {
              min: { x: limitNumber('min.x'), y: limitNumber('min.y'), z: limitNumber('min.z') },
              max: { x: limitNumber('max.x'), y: limitNumber('max.y'), z: limitNumber('max.z') },
            },
          }),
          ...(limitNumber('feedMmMin') !== undefined && { feedMmMin: limitNumber('feedMmMin') }),
          ...(limitNumber('extruder') !== undefined && { extruder: limitNumber('extruder') }),
          ...(limitNumber('bed') !== undefined && { bed: limitNumber('bed') }),
        },
      },
    })
    if (!parsed.success || (isPlainHttp && !plainHttp) || !send(parsed.data)) {
      setInvalid(true)
      return
    }
    onClose()
  }
  return (
    <Modal title={UI_TEXT.makerAddMachine} titleId="maker-wizard-title" onClose={onClose}>
      {stop}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label>
          {UI_TEXT.makerName}
          <input
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        </label>
        <label>
          {UI_TEXT.makerMachineId}
          <input
            required
            value={id}
            onChange={(event) => {
              setId(event.target.value)
            }}
          />
        </label>
        {[
          { label: UI_TEXT.makerKind, value: kind, choices: KINDS, update: setKind },
          {
            label: UI_TEXT.makerCategory,
            value: category,
            choices: CATEGORIES,
            update: setCategory,
          },
        ].map((field) => (
          <label key={field.label}>
            {field.label}
            <select
              value={field.value}
              onChange={(event) => {
                field.update(event.target.value)
              }}
            >
              {field.choices.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          {UI_TEXT.makerEndpoint}
          <input
            required
            value={endpoint}
            onChange={(event) => {
              setEndpoint(event.target.value)
              setPlainHttp(false)
            }}
          />
        </label>
        {isPlainHttp && (
          <label>
            <input
              type="checkbox"
              required
              checked={plainHttp}
              onChange={(event) => {
                setPlainHttp(event.target.checked)
              }}
            />
            {UI_TEXT.makerPlainHttpWarning}
          </label>
        )}
        <fieldset>
          <legend>{UI_TEXT.makerLimitsTitle}</legend>
          <p>{UI_TEXT.makerLimitsUnavailable}</p>
          {AXES.map((axis) => (
            <div key={axis}>
              {['min', 'max'].map((bound) => (
                <label key={bound}>
                  {fill(bound === 'min' ? UI_TEXT.makerTravelMin : UI_TEXT.makerTravelMax, {
                    axis,
                  })}
                  <input
                    type="number"
                    step="any"
                    value={limits[`${bound}.${axis}`] ?? ''}
                    onChange={(event) => {
                      setLimits({ ...limits, [`${bound}.${axis}`]: event.target.value })
                    }}
                  />
                </label>
              ))}
            </div>
          ))}
          {[
            ['feedMmMin', UI_TEXT.makerFeed],
            ['extruder', UI_TEXT.makerExtruder],
            ['bed', UI_TEXT.makerBed],
          ].map(([key, label]) =>
            key === undefined ? null : (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={limits[key] ?? ''}
                  onChange={(event) => {
                    setLimits({ ...limits, [key]: event.target.value })
                  }}
                />
              </label>
            ),
          )}
        </fieldset>
        {invalid && <p role="alert">{UI_TEXT.makerInvalidInput}</p>}
        <button type="submit" className="button-primary">
          {UI_TEXT.makerAddMachine}
        </button>
      </form>
    </Modal>
  )
}
