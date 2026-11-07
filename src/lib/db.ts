import type {Ev} from './types'

let dbp: Promise<IDBDatabase> | null = null
function db() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('telsiz', 1)
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore('events', {keyPath: 'key'})
      s.createIndex('g', 'g')
      r.result.createObjectStore('files')
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error) })
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

export async function saveEvents(code: string, evs: Ev[]) {
  const t = (await db()).transaction('events', 'readwrite')
  for (const e of evs) t.objectStore('events').put({key: `${code}:${e.id}`, g: code, e})
  return done(t)
}
export async function loadEvents(code: string): Promise<Ev[]> {
  const t = (await db()).transaction('events')
  const rows = await req(t.objectStore('events').index('g').getAll(code))
  return rows.map((r: {e: Ev}) => r.e)
}
export async function deleteEvents(code: string, ids: string[]) {
  const t = (await db()).transaction('events', 'readwrite')
  for (const id of ids) t.objectStore('events').delete(`${code}:${id}`)
  return done(t)
}
export async function moveEvents(from: string, to: string) {
  const t = (await db()).transaction('events', 'readwrite')
  const store = t.objectStore('events')
  const rows = await req(store.index('g').getAll(from)) as {key: string; e: Ev}[]
  for (const r of rows) {
    store.delete(r.key)
    store.put({key: `${to}:${r.e.id}`, g: to, e: r.e})
  }
  return done(t)
}
export async function deleteFile(id: string) {
  const t = (await db()).transaction('files', 'readwrite')
  t.objectStore('files').delete(id)
  return done(t)
}
export async function dropGroup(code: string) {
  const t = (await db()).transaction('events', 'readwrite')
  const keys = await req(t.objectStore('events').index('g').getAllKeys(code))
  for (const k of keys) t.objectStore('events').delete(k)
  return done(t)
}
export async function saveFile(id: string, blob: Blob) {
  const t = (await db()).transaction('files', 'readwrite')
  t.objectStore('files').put(blob, id)
  return done(t)
}
export async function getFile(id: string): Promise<Blob | undefined> {
  return req((await db()).transaction('files').objectStore('files').get(id))
}
