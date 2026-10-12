import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { countWords } from '../lib/text'
import { formatDuration, msPerWord } from '../lib/timing'
import { SAMPLE } from '../lib/sample'
import { ACCEPT, ImportError, importFile, type Imported } from '../lib/import'

interface EditorProps {
  text: string
  title: string | null
  onChange: (text: string) => void
  onImport: (imported: Imported) => void
  wpm: number
  prefix: Float64Array
  progress: number
  onStart: (fromStart: boolean) => void
}

type ImportState = { kind: 'idle' } | { kind: 'busy'; message: string } | { kind: 'error'; message: string }

export function Editor({ text, title, onChange, onImport, wpm, prefix, progress, onStart }: EditorProps) {
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const words = countWords(text)
  const canResume = progress > 0 && words > 0
  const busy = importState.kind === 'busy'
  // The prefix trails the text by a render while typing or importing, so scale its average to the live count.
  const weightPerWord = prefix.length > 1 ? prefix[prefix.length - 1] / (prefix.length - 1) : 1
  const estimateMs = words * weightPerWord * msPerWord(wpm)

  const open = async (file: File | undefined) => {
    if (!file || busy) return
    setImportState({ kind: 'busy', message: `Opening ${file.name}` })
    try {
      const imported = await importFile(file, (message) => setImportState({ kind: 'busy', message }))
      onImport(imported)
      setImportState({ kind: 'idle' })
    } catch (error) {
      const message =
        error instanceof ImportError
          ? error.message
          : `${file.name} could not be read. The file may be damaged.`
      setImportState({ kind: 'error', message })
    }
  }

  const status =
    importState.kind !== 'idle'
      ? importState.message
      : words === 0
        ? 'Nothing to read yet.'
        : `${title ? `${title}. ` : ''}${words.toLocaleString()} words, about ${formatDuration(estimateMs)} at ${wpm} wpm`

  return (
    <div
      className="editor"
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        open(e.dataTransfer.files[0])
      }}
    >
      <header className="editor-head">
        <span className="wordmark">Pacer</span>
      </header>

      <main className="editor-main">
        <p className="editor-intro">
          Paste something long or open a PDF or EPUB. Pacer moves a highlighter through it at your
          pace, and the words around it stay on the page.
        </p>

        <textarea
          className="editor-input"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste an article, a chapter, or notes you need to get through."
          spellCheck={false}
          disabled={busy}
          autoFocus
        />

        <div className="editor-foot">
          <p
            className="editor-count"
            data-state={importState.kind}
            role={importState.kind === 'error' ? 'alert' : 'status'}
          >
            {status}
          </p>
          <div className="editor-actions">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                open(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
              <FileUp size={16} aria-hidden />
              Open file
            </button>
            {words === 0 ? (
              <button type="button" className="btn" disabled={busy} onClick={() => onChange(SAMPLE)}>
                Try a sample
              </button>
            ) : canResume ? (
              <button type="button" className="btn" disabled={busy} onClick={() => onStart(true)}>
                Start over
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              disabled={words === 0 || busy}
              onClick={() => onStart(false)}
            >
              {canResume ? `Resume at ${Math.round(progress * 100)}%` : 'Start reading'}
            </button>
          </div>
        </div>
      </main>

      <div className="drop-hint" aria-hidden>
        <p>Drop to open</p>
        <span>PDF, EPUB or plain text</span>
      </div>
    </div>
  )
}
