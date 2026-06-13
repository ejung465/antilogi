import {
  MEDIA_ACTION_LABELS,
  type GestureDirection,
  type Mappings,
  type MediaAction
} from '../../../shared/types'

const ROWS: { dir: GestureDirection; label: string; hint: string }[] = [
  { dir: 'click', label: 'Press', hint: 'tap the thumb button' },
  { dir: 'up', label: 'Swipe ↑', hint: 'hold + push away' },
  { dir: 'down', label: 'Swipe ↓', hint: 'hold + pull toward you' },
  { dir: 'left', label: 'Swipe ←', hint: 'hold + move left' },
  { dir: 'right', label: 'Swipe →', hint: 'hold + move right' }
]

const ACTIONS = Object.keys(MEDIA_ACTION_LABELS) as MediaAction[]

export function MappingMatrix({
  mappings,
  onChange,
  onTest
}: {
  mappings: Mappings
  onChange: (direction: GestureDirection, action: MediaAction) => void
  onTest: (action: MediaAction) => void
}) {
  return (
    <div className="matrix">
      {ROWS.map((row) => (
        <div className="matrix-row" key={row.dir}>
          <div className="matrix-label">
            <span>{row.label}</span>
            <small>{row.hint}</small>
          </div>
          <select value={mappings[row.dir]} onChange={(e) => onChange(row.dir, e.target.value as MediaAction)}>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {MEDIA_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
          <button className="ghost" disabled={mappings[row.dir] === 'none'} onClick={() => onTest(mappings[row.dir])}>
            Test
          </button>
        </div>
      ))}
    </div>
  )
}
