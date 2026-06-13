import { useEffect, useState } from 'react'
import type { EngineSettings } from '../../../shared/types'
import { StatusCard } from './StatusCard'

function formatCid(cid: number): string {
  return `0x${cid.toString(16).toUpperCase().padStart(2, '0')}`
}

function parseCid(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{1,4}$/.test(t)) return null
  return parseInt(t, 16)
}

export function TuningCard({
  engine,
  onChange
}: {
  engine: EngineSettings
  onChange: (patch: Partial<EngineSettings>) => void
}) {
  const [cidText, setCidText] = useState(formatCid(engine.cid))
  useEffect(() => setCidText(formatCid(engine.cid)), [engine.cid])

  const commitCid = (): void => {
    const parsed = parseCid(cidText)
    if (parsed === null || parsed === engine.cid) {
      setCidText(formatCid(engine.cid))
      return
    }
    onChange({ cid: parsed })
  }

  return (
    <StatusCard title="Tuning">
      <div className="tuning-row">
        <label>
          Tap threshold
          <small>counts of motion below which press+release is a tap</small>
        </label>
        <input
          type="number"
          min={4}
          max={200}
          value={engine.tapThreshold}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v) && v >= 4 && v <= 200) onChange({ tapThreshold: v })
          }}
        />
      </div>
      <div className="tuning-row">
        <label>
          Volume step interval
          <small>counts dragged per repeated volume step</small>
        </label>
        <input
          type="number"
          min={10}
          max={400}
          value={engine.volumeInterval}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v) && v >= 10 && v <= 400) onChange({ volumeInterval: v })
          }}
        />
      </div>
      <div className="tuning-row">
        <label>
          Control ID (hex)
          <small>0xD0 = M720 gesture button — change only for other mice</small>
        </label>
        <input
          type="text"
          value={cidText}
          spellCheck={false}
          onChange={(e) => setCidText(e.target.value)}
          onBlur={commitCid}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitCid()
          }}
        />
      </div>
    </StatusCard>
  )
}
