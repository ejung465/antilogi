import type {
  AppState,
  EngineSettings,
  Mappings,
  MediaAction,
  PermissionKind,
  PushChannel,
  PushPayloads
} from '../shared/types'

declare global {
  interface Window {
    antilogi: {
      getState(): Promise<AppState>
      setMappings(mappings: Partial<Mappings>): Promise<void>
      setEngine(engine: Partial<EngineSettings>): Promise<void>
      rescan(): Promise<void>
      openPermission(kind: PermissionKind): Promise<void>
      testAction(action: MediaAction): Promise<void>
      on<C extends PushChannel>(channel: C, listener: (payload: PushPayloads[C]) => void): () => void
    }
  }
}

export {}
