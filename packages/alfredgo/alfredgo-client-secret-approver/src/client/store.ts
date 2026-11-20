/**
 * Browser storage of the approver: the device keys, encrypted credentials, paired
 * injectors, and approval modes. Keys are non-extractable `CryptoKey` objects that
 * IndexedDB stores by structured clone, so they never leave this browser profile.
 */
import type { PublicJwk } from './crypto.ts'

/** The approver device: signing key, credential vault key, and public pairing data. */
export interface DeviceRecord {
  readonly id: string
  readonly user: string
  readonly signing: CryptoKey
  readonly vault: CryptoKey
  readonly jwk: PublicJwk
}

/** One encrypted value under the vault key. */
export interface Ciphertext {
  readonly iv: Uint8Array<ArrayBuffer>
  readonly ct: ArrayBuffer
}

/** One stored credential, its named copies, and the GitHub repositories it may be used for. */
export interface SecretRecord extends Ciphertext {
  readonly alias: string
  readonly repos: readonly string[]
  readonly copies: Readonly<Record<string, Ciphertext>>
}

/** One paired injector: its request-signing key and its sealing key. */
export interface InjectorRecord {
  readonly id: string
  readonly jwk: PublicJwk
  readonly enc_jwk: PublicJwk
}

/** One automatic approval rule; each field is a glob with `*` and `?`. */
export interface AutoRule {
  readonly kind: string
  readonly secret: string
  readonly tool: string
  readonly target: string
}

/** A remembered "allow n times" or "allow for a while" answer. */
export interface Grant {
  readonly key: string
  readonly remaining: number | null
  readonly expires: number | null
  readonly choices: Readonly<Record<string, string>>
}

/** Values kept in the `settings` store, by key. */
export interface SettingsRecords {
  allUntil: number
  autoRules: readonly AutoRule[]
  grants: readonly Grant[]
}

/** Records of every object store, by store name. */
export interface StoreRecords {
  device: DeviceRecord
  secrets: SecretRecord
  injectors: InjectorRecord
}

/** Persistent approver storage. */
export interface ApproverStore {
  /** @returns the device, or undefined before one is created. */
  device(): Promise<DeviceRecord | undefined>
  /** @param device - the new device; stored once. */
  putDevice(device: DeviceRecord): Promise<void>
  /** @returns the record under `key`, or undefined. */
  get<N extends 'secrets' | 'injectors'>(name: N, key: string): Promise<StoreRecords[N] | undefined>
  /** @returns every record of the store. */
  all<N extends 'secrets' | 'injectors'>(name: N): Promise<StoreRecords[N][]>
  /** Store a record under `key`. */
  put<N extends 'secrets' | 'injectors'>(name: N, key: string, value: StoreRecords[N]): Promise<void>
  /** Remove the record under `key`. */
  remove(name: 'secrets' | 'injectors', key: string): Promise<void>
  /** @returns the setting, or `fallback`. */
  setting<K extends keyof SettingsRecords>(key: K, fallback: SettingsRecords[K]): Promise<SettingsRecords[K]>
  /** Store a setting. */
  putSetting<K extends keyof SettingsRecords>(key: K, value: SettingsRecords[K]): Promise<void>
}

/** IndexedDB database name; separate from AgentSecret's own page so the two never share a device. */
export const DATABASE = 'alfredgo-secret-approver'
const STORES = ['device', 'secrets', 'injectors', 'settings'] as const

/**
 * Open the approver's IndexedDB storage.
 * @param factory - the browser's IndexedDB factory.
 * @returns the store; requests fail with the IndexedDB error when storage is unavailable.
 */
export function openIndexedDbStore(factory: IDBFactory): ApproverStore {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
    }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB is unavailable')) }
  })
  const run = async <T>(name: typeof STORES[number], mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const tx = (await database).transaction(name, mode)
    return await new Promise<T>((resolve, reject) => {
      const request = body(tx.objectStore(name))
      tx.oncomplete = () => { resolve(request.result as T) }
      tx.onerror = () => { reject(tx.error ?? new Error('IndexedDB write failed')) }
      tx.onabort = () => { reject(tx.error ?? new Error('IndexedDB transaction aborted')) }
    })
  }
  return {
    device: async () => await run<DeviceRecord | undefined>('device', 'readonly', s => s.get('device')),
    putDevice: async (device) => { await run('device', 'readwrite', s => s.put(device, 'device')) },
    get: async (name, key) => await run(name, 'readonly', s => s.get(key)),
    all: async name => await run(name, 'readonly', s => s.getAll()),
    put: async (name, key, value) => { await run(name, 'readwrite', s => s.put(value, key)) },
    remove: async (name, key) => { await run(name, 'readwrite', s => s.delete(key)) },
    setting: async (key, fallback) => (await run<SettingsRecords[typeof key] | undefined>('settings', 'readonly', s => s.get(key))) ?? fallback,
    putSetting: async (key, value) => { await run('settings', 'readwrite', s => s.put(value, key)) },
  }
}

/**
 * In-memory storage with the same behavior, for a browser without IndexedDB and for tests.
 * @returns an empty store.
 */
export function createMemoryStore(): ApproverStore {
  let device: DeviceRecord | undefined
  const maps = { secrets: new Map<string, SecretRecord>(), injectors: new Map<string, InjectorRecord>() }
  const settings = new Map<string, unknown>()
  return {
    device: () => Promise.resolve(device),
    putDevice: (value) => { device = value; return Promise.resolve() },
    get: (name, key) => Promise.resolve(maps[name].get(key) as StoreRecords[typeof name] | undefined),
    all: name => Promise.resolve([...maps[name].values()] as StoreRecords[typeof name][]),
    put: (name, key, value) => { (maps[name] as Map<string, StoreRecords[typeof name]>).set(key, value); return Promise.resolve() },
    remove: (name, key) => { maps[name].delete(key); return Promise.resolve() },
    setting: (key, fallback) => Promise.resolve((settings.has(key) ? settings.get(key) : fallback) as SettingsRecords[typeof key]),
    putSetting: (key, value) => { settings.set(key, value); return Promise.resolve() },
  }
}
