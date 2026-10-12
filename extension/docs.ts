export type DocKind = 'pdf' | 'article'

export interface DocRecord {
  id: string
  kind: DocKind
  /** The URL the document came from, hash included. */
  src: string
  title: string | null
  bytes?: ArrayBuffer
  text?: string
  /** Paragraph at the top of the window when Pacer was pressed. */
  startParagraph?: number
  error?: { message: string; fileAccess?: boolean }
  at: number
}

const DB_NAME = 'pacer'
const STORE = 'docs'
// Reloading a Pacer tab or going Back to one reads its record again, so keep the recent ones.
const KEEP = 20

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('at', 'at')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function putDoc(record: DocRecord): Promise<void> {
  const db = await open()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.put(record)
    let seen = 0
    store.index('at').openKeyCursor(null, 'prev').onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursor | null>).result
      if (!cursor) return
      seen += 1
      if (seen > KEEP) store.delete(cursor.primaryKey)
      cursor.continue()
    }
    await done(tx)
  } finally {
    db.close()
  }
}

export async function getDoc(id: string): Promise<DocRecord | null> {
  const db = await open()
  try {
    const request = db.transaction(STORE).objectStore(STORE).get(id)
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as DocRecord | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
