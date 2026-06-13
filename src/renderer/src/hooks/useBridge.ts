import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_MAPPINGS,
  IPC,
  type AppState,
  type EngineSettings,
  type GestureDirection,
  type MediaAction,
  type PermissionKind
} from '../../../shared/types'

export interface FeedItem {
  id: number
  at: number
  kind: 'gesture' | 'media' | 'log'
  level?: 'info' | 'warn' | 'error'
  text: string
}

const INITIAL: AppState = {
  device: { state: 'searching' },
  permissions: { accessibility: 'unknown', inputMonitoring: 'unknown', bluetooth: 'unknown' },
  mappings: DEFAULT_MAPPINGS,
  engine: { tapThreshold: 20, volumeInterval: 75, cid: 0xd0 }
}

let feedSeq = 0

export function useBridge() {
  const [state, setState] = useState<AppState>(INITIAL)
  const [feed, setFeed] = useState<FeedItem[]>([])

  const pushFeed = useCallback((item: Omit<FeedItem, 'id'>) => {
    setFeed((prev) => [...prev.slice(-79), { ...item, id: feedSeq++ }])
  }, [])

  useEffect(() => {
    let alive = true
    void window.antilogi.getState().then((s) => {
      if (alive) setState(s)
    })
    const offs = [
      window.antilogi.on(IPC.PushDevice, (device) => setState((s) => ({ ...s, device }))),
      window.antilogi.on(IPC.PushPermissions, (permissions) => setState((s) => ({ ...s, permissions }))),
      window.antilogi.on(IPC.PushGesture, (g) =>
        pushFeed({ at: g.at, kind: 'gesture', text: `gesture ${g.direction} → ${g.action}` })
      ),
      window.antilogi.on(IPC.PushMedia, (m) =>
        pushFeed({ at: m.at, kind: 'media', text: `media ${m.action} fired via ${m.via}` })
      ),
      window.antilogi.on(IPC.PushLog, (l) => pushFeed({ at: l.at, kind: 'log', level: l.level, text: l.msg }))
    ]
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
  }, [pushFeed])

  const setMapping = useCallback((direction: GestureDirection, action: MediaAction) => {
    setState((s) => ({ ...s, mappings: { ...s.mappings, [direction]: action } }))
    void window.antilogi.setMappings({ [direction]: action })
  }, [])

  const setEngine = useCallback((patch: Partial<EngineSettings>) => {
    setState((s) => ({ ...s, engine: { ...s.engine, ...patch } }))
    void window.antilogi.setEngine(patch)
  }, [])

  return {
    state,
    feed,
    setMapping,
    setEngine,
    rescan: useCallback(() => void window.antilogi.rescan(), []),
    test: useCallback((action: MediaAction) => void window.antilogi.testAction(action), []),
    openPermission: useCallback((kind: PermissionKind) => void window.antilogi.openPermission(kind), [])
  }
}
