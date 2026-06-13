import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_MAPPINGS, type EngineSettings, type Mappings } from '../shared/types'
import { CID_M720_GESTURE } from './hid/constants'

export interface PersistedConfig {
  mappings: Mappings
  engine: EngineSettings
}

const DEFAULTS: PersistedConfig = {
  mappings: DEFAULT_MAPPINGS,
  engine: { tapThreshold: 20, volumeInterval: 75, cid: CID_M720_GESTURE }
}

/** Tiny atomic JSON store — no native deps, no ESM/CJS interop headaches. */
export class ConfigStore {
  private config: PersistedConfig

  constructor(private readonly file: string) {
    this.config = this.load()
  }

  private load(): PersistedConfig {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<PersistedConfig>
      return {
        mappings: { ...DEFAULTS.mappings, ...(raw.mappings ?? {}) },
        engine: { ...DEFAULTS.engine, ...(raw.engine ?? {}) }
      }
    } catch {
      return structuredClone(DEFAULTS)
    }
  }

  get(): PersistedConfig {
    return this.config
  }

  update(patch: { mappings?: Partial<Mappings>; engine?: Partial<EngineSettings> }): PersistedConfig {
    this.config = {
      mappings: { ...this.config.mappings, ...(patch.mappings ?? {}) },
      engine: { ...this.config.engine, ...(patch.engine ?? {}) }
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.config, null, 2))
      renameSync(tmp, this.file)
    } catch {
      // persistence is best-effort; the in-memory config still applies
    }
    return this.config
  }
}

export function defaultConfigPath(userDataDir: string): string {
  return join(userDataDir, 'config.json')
}
