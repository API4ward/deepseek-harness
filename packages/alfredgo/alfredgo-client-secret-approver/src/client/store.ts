/**
 * Browser storage of the approver: the device keys, encrypted credentials, paired
 * injectors, approval modes, and the approval history. Keys are non-extractable `CryptoKey` objects that
 * IndexedDB stores by structured clone, so they never leave this browser profile.
 */
import type { RejectReason } from './approver.ts'
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

/** How a decision was made. */
export type DecisionWay = 'user' | 'all' | 'grant' | 'rule' | 'auto-deny'

/** What an approval returned for one credential, without the value: `default`, `copy:<label>`, `mock`, or `manual`. */
export type ReturnedValue = string

/** One answered request in the approval history; holds aliases and value kinds, never a credential value. */
export interface HistoryRecord {
  /** Store key: zero-padded decision time and request id, so keys sort by time. */
  readonly key: string
  readonly at: number
  readonly requestId: string
  readonly kind: 'reference' | 'use' | 'reveal' | 'fill'
  readonly project: string
  readonly task: string
  readonly injector: string
  readonly secrets: readonly string[]
  readonly tool: string
  readonly target: string
  readonly operation: string
  readonly decision: 'approve' | 'deny'
  readonly way: DecisionWay
  /** Signed reject reason of an automatic denial; empty otherwise. */
  readonly reason: RejectReason | ''
  /** For approved `use` and `fill` requests, what each credential returned. */
  readonly returned: Readonly<Record<string, ReturnedValue>>
  /** "Allow n times" or "allow for n seconds" chosen with a manual approval. */
  readonly grant: { readonly times: number } | { readonly seconds: number } | null
  /** The exact request text the injector signed. */
  readonly requestText: string
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
  /** @returns every history record, oldest first. */
  history(): Promise<HistoryRecord[]>
  /** Append one history record. */
  addHistory(record: HistoryRecord): Promise<void>
  /** Remove the history records older than `oldestKept`. */
  trimHistory(oldestKept: string): Promise<void>
  /** Remove every history record. */
  clearHistory(): Promise<void>
}

/** IndexedDB database name; separate from AgentSecret's own page so the two never share a device. */
export const DATABASE = 'alfredgo-secret-approver'
const STORES = ['device', 'secrets', 'injectors', 'settings', 'history'] as const

/**
 * Open the approver's IndexedDB storage.
 * @param factory - the browser's IndexedDB factory.
 * @returns the store; requests fail with the IndexedDB error when storage is unavailable.
 */
export function openIndexedDbStore(factory: IDBFactory): ApproverStore {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    // Version 2 adds the `history` store; the upgrade only creates missing stores.
    const request = factory.open(DATABASE, 2)
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
    history: async () => await run('history', 'readonly', s => s.getAll()),
    addHistory: async (record) => { await run('history', 'readwrite', s => s.put(record, record.key)) },
    trimHistory: async (oldestKept) => { await run('history', 'readwrite', s => s.delete(IDBKeyRange.upperBound(oldestKept, true))) },
    clearHistory: async () => { await run('history', 'readwrite', s => s.clear()) },
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
  let history: HistoryRecord[] = []
  return {
    device: () => Promise.resolve(device),
    putDevice: (value) => { device = value; return Promise.resolve() },
    get: (name, key) => Promise.resolve(maps[name].get(key) as StoreRecords[typeof name] | undefined),
    all: name => Promise.resolve([...maps[name].values()] as StoreRecords[typeof name][]),
    put: (name, key, value) => { (maps[name] as Map<string, StoreRecords[typeof name]>).set(key, value); return Promise.resolve() },
    remove: (name, key) => { maps[name].delete(key); return Promise.resolve() },
    setting: (key, fallback) => Promise.resolve((settings.has(key) ? settings.get(key) : fallback) as SettingsRecords[typeof key]),
    putSetting: (key, value) => { settings.set(key, value); return Promise.resolve() },
    history: () => Promise.resolve([...history]),
    addHistory: (record) => { history = [...history, record].sort((a, b) => a.key < b.key ? -1 : 1); return Promise.resolve() },
    trimHistory: (oldestKept) => { history = history.filter(r => r.key >= oldestKept); return Promise.resolve() },
    clearHistory: () => { history = []; return Promise.resolve() },
  }
}
