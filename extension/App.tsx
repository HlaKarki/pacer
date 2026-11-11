import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { FileUp } from 'lucide-react'
import { ReaderScreen } from '../src/components/ReaderScreen'
import { ImportError } from '../src/lib/import/errors'
import { findText, parse, type Doc } from '../src/lib/text'
import { revealParagraph, showPdfPage, sourceOf, switchTo, type Source } from './back'
import { frequency } from './frequency'
import { paragraphOnPage, withPage } from './pages'
import { FileAccessError, openDoc, openFile, PICKABLE, type Opened } from './source'
import { startFrom, type ExtensionStore } from './store'

type Screen =
  | { kind: 'busy'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'file-access' }
  | { kind: 'picker'; error: string | null }
  | { kind: 'reader'; opened: Opened; doc: Doc; index: number; id: number }

interface Reading {
  opened: Opened
  doc: Doc
  index: number
}

const exitLabel = (opened: Opened) => (opened.src === null ? 'Files' : opened.pages ? 'PDF' : 'Page')

const paragraphText = (doc: Doc, para: number) => {
  const p = doc.paragraphs[para]
  return p ? doc.words.slice(p.start, p.end).map((w) => w.text).join(' ') : ''
}

async function navigate(url: string) {
  // Chrome blocks extension pages from opening file: URLs directly, so go through the tabs API.
  if (url.startsWith('file:')) {
    const tab = await chrome.tabs.getCurrent()
    if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { url })
  } else {
    location.replace(url)
  }
}

function useShortcut(): string {
  const [shortcut, setShortcut] = useState('')
  useEffect(() => {
    chrome.commands.getAll().then(
      (commands) => setShortcut(commands.find((c) => c.name === '_execute_action')?.shortcut ?? ''),
      () => setShortcut(''),
    )
  }, [])
  return shortcut
}

function Page({ children, onFile }: { children: ReactNode; onFile?: (file: File) => void }) {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className="pc-page"
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        if (!onFile || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!onFile) return
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
    >
      <header className="pc-page-head">
        <span className="pc-wordmark">Pacer</span>
      </header>
      <main className="pc-page-main">{children}</main>
      {onFile ? (
        <div className="pc-drop-hint" aria-hidden>
          <p>Drop to open</p>
          <span>PDF or EPUB</span>
        </div>
      ) : null}
    </div>
  )
}

function ChooseFile({ onFile, primary = false }: { onFile: (file: File) => void; primary?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={PICKABLE}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
      <button type="button" className={primary ? 'pc-btn pc-btn-primary' : 'pc-btn'} onClick={() => input.current?.click()}>
        <FileUp size={16} aria-hidden />
        {primary ? 'Choose a PDF or EPUB' : 'Choose the file'}
      </button>
    </>
  )
}

export function App({ store, docId }: { store: ExtensionStore; docId: string | null }) {
  const [screen, setScreen] = useState<Screen>(
    docId ? { kind: 'busy', message: 'Opening' } : { kind: 'picker', error: null },
  )
  const theme = useSyncExternalStore(store.subscribe, () => store.getSettings().theme)
  const shortcut = useShortcut()
  const opens = useRef(0)
  const reading = useRef<Reading | null>(null)
  const [source, setSource] = useState<Source | null>(null)

  useEffect(() => {
    if (docId) sourceOf(docId).then(setSource, () => setSource(null))
  }, [docId])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  const load = useCallback(
    async (open: (onProgress: (message: string) => void) => Promise<Opened>, picked: boolean) => {
      const id = ++opens.current
      const onProgress = (message: string) => {
        if (id === opens.current) setScreen({ kind: 'busy', message })
      }
      try {
        let opened = await open(onProgress)
        const doc = parse(opened.text)
        if (!doc.words.length) throw new ImportError('There is nothing to read in this document.')
        const found = opened.startText ? findText(doc, opened.startText) : -1
        // Places save against startParagraph, so it moves to the picked word's paragraph too.
        if (found >= 0) opened = { ...opened, startParagraph: doc.words[found].para }
        const index = found >= 0 ? found : startFrom(doc, opened.startParagraph, await store.place(opened.key))
        if (id !== opens.current) return
        reading.current = { opened, doc, index }
        document.title = opened.title
        setScreen({ kind: 'reader', opened, doc, index, id })
      } catch (error) {
        if (id !== opens.current) return
        if (error instanceof FileAccessError) {
          setScreen({ kind: 'file-access' })
          return
        }
        if (!(error instanceof ImportError)) console.error(error)
        const message = error instanceof ImportError ? error.message : 'Pacer could not read this document.'
        setScreen(picked ? { kind: 'picker', error: message } : { kind: 'error', message })
      }
    },
    [store],
  )

  const pick = useCallback((file: File) => void load((onProgress) => openFile(file, onProgress), true), [load])

  useEffect(() => {
    if (docId) void load((onProgress) => openDoc(docId, onProgress), false)
  }, [docId, load])

  useEffect(() => {
    const flush = () => void store.flush()
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [store])

  const onIndex = useCallback(
    (index: number) => {
      const current = reading.current
      if (!current) return
      current.index = index
      store.setPlace(current.opened.key, {
        index,
        words: current.doc.words.length,
        from: current.opened.startParagraph,
      })
    },
    [store],
  )

  const leave = useCallback(async () => {
    const current = reading.current
    if (!current) return
    const { opened, doc, index } = current
    if (opened.src === null) {
      await store.flush()
      reading.current = null
      document.title = 'Pacer'
      setScreen({ kind: 'picker', error: null })
      return
    }

    const para = doc.words[index]?.para ?? 0
    const page = opened.pages ? (opened.pages[para] ?? 1) : null
    const back = docId ? await sourceOf(docId) : null
    // The next press starts from wherever the page is left, so save the place against that paragraph.
    let from = opened.startParagraph
    if (opened.pages && page !== null) {
      if (!back || (await showPdfPage(back, page))) from = paragraphOnPage(opened.pages, page)
    } else if (back) {
      const scrolled = await revealParagraph(back, paragraphText(doc, para))
      if (scrolled !== null) from = scrolled ? para : 0
    } else {
      from = 0
    }
    store.setPlace(opened.key, { index, words: doc.words.length, from })
    await store.flush()

    if (back && (await switchTo(back))) return
    await navigate(page !== null ? withPage(opened.src, page) : opened.src)
  }, [store, docId])

  const goBack = useCallback(async () => {
    if (source && !(await switchTo(source))) await navigate(source.src)
  }, [source])

  switch (screen.kind) {
    case 'reader':
      return (
        <ReaderScreen
          key={screen.id}
          doc={screen.doc}
          title={screen.opened.title}
          initialIndex={screen.index}
          store={store}
          freq={frequency()}
          keyTarget={window}
          exitLabel={exitLabel(screen.opened)}
          onIndex={onIndex}
          onExit={() => void leave()}
          showTheme
        />
      )
    case 'busy':
      return (
        <Page>
          <p className="pc-page-note" role="status">
            {screen.message}
          </p>
        </Page>
      )
    case 'error':
      return (
        <Page>
          <p className="pc-page-lead" role="alert">
            {screen.message}
          </p>
          {source ? (
            <div className="pc-page-actions">
              <button type="button" className="pc-btn" onClick={() => void goBack()}>
                Go back
              </button>
            </div>
          ) : null}
        </Page>
      )
    case 'file-access':
      return (
        <Page onFile={pick}>
          <p className="pc-page-lead">Chrome keeps local files from Pacer until you allow it.</p>
          <p className="pc-page-note">
            Open Pacer’s settings, turn on <strong>Allow access to file URLs</strong>, then go back and press Pacer again.
            Or choose the file here to read it once.
          </p>
          <div className="pc-page-actions">
            <button
              type="button"
              className="pc-btn pc-btn-primary"
              onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}
            >
              Open Pacer’s settings
            </button>
            <ChooseFile onFile={pick} />
            {source ? (
              <button type="button" className="pc-btn pc-btn-quiet" onClick={() => void goBack()}>
                Go back
              </button>
            ) : null}
          </div>
        </Page>
      )
    case 'picker':
      return (
        <Page onFile={pick}>
          <p className="pc-page-lead">
            Open a PDF or EPUB from your computer. Pacer moves a highlighter through it at your pace.
          </p>
          <div className="pc-page-actions">
            <ChooseFile onFile={pick} primary />
          </div>
          <p className="pc-page-note" data-error={screen.error ? true : undefined} role={screen.error ? 'alert' : undefined}>
            {screen.error ??
              (shortcut
                ? `On a web page, press the Pacer button or ${shortcut} to read it in place. PDFs open here.`
                : 'On a web page, press the Pacer button to read it in place. PDFs open here.')}
          </p>
        </Page>
      )
  }
}
