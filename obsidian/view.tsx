import { FileView, MarkdownView, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import { createRoot, type Root } from 'react-dom/client'
import { ImportError } from '../src/lib/import/errors'
import { parse, type Doc } from '../src/lib/text'
import type PacerPlugin from './main'
import { lineAtWord, startIndex } from './note'
import { ReaderScreen } from './ReaderScreen'
import { loadSource } from './source'

export const VIEW_TYPE = 'pacer'

/** How the note was shown before Pacer took the tab, so leaving restores it. */
export interface BackState {
  mode?: unknown
  source?: unknown
}

type Screen =
  | { kind: 'message'; text: string; error?: boolean }
  | { kind: 'reader'; doc: Doc; title: string; index: number; exitLabel: string | null }

const EXIT_LABELS: Record<string, string> = { md: 'Note', pdf: 'PDF' }

export class PacerView extends FileView {
  navigation = true
  private plugin: PacerPlugin
  private rootEl: HTMLElement
  private root: Root | null = null
  private cursorLine: number | null = null
  private back: BackState = {}
  private loaded: { doc: Doc; paragraphLines: number[] | null; index: number } | null = null
  private loadId = 0

  constructor(leaf: WorkspaceLeaf, plugin: PacerPlugin) {
    super(leaf)
    this.plugin = plugin
    this.rootEl = document.createElement('div')
    this.rootEl.className = 'pc-root'
    // Focusable so Pacer's keys only fire while this tab has focus.
    this.rootEl.tabIndex = -1
    this.contentEl.appendChild(this.rootEl)
  }

  getViewType() {
    return VIEW_TYPE
  }

  getIcon() {
    return 'highlighter'
  }

  getDisplayText() {
    return this.file?.basename ?? 'Pacer'
  }

  canAcceptExtension(extension: string) {
    return extension === 'epub'
  }

  onload() {
    super.onload()
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf) this.rootEl.focus({ preventScroll: true })
      }),
    )
  }

  async setState(state: unknown, result: ViewStateResult) {
    const { line, mode, source } = (state ?? {}) as { line?: unknown } & BackState
    this.cursorLine = typeof line === 'number' ? line : null
    this.back = { mode, source }
    await super.setState(state, result)
  }

  getState() {
    const state: Record<string, unknown> = super.getState()
    if (this.back.mode !== undefined) state.mode = this.back.mode
    if (this.back.source !== undefined) state.source = this.back.source
    return state
  }

  async onLoadFile(file: TFile) {
    const id = ++this.loadId
    this.show({ kind: 'message', text: `Opening ${file.basename}` })
    try {
      const source = await loadSource(this.app, file, (text) => {
        if (id === this.loadId) this.show({ kind: 'message', text })
      })
      if (id !== this.loadId) return
      const doc = parse(source.text)
      if (!doc.words.length) {
        this.show({ kind: 'message', text: 'Nothing to read in this note.' })
        return
      }
      const index = startIndex(doc, source.paragraphLines, this.cursorLine, this.plugin.store.place(file.path))
      this.cursorLine = null
      this.loaded = { doc, paragraphLines: source.paragraphLines, index }
      this.show({ kind: 'reader', doc, title: source.title, index, exitLabel: EXIT_LABELS[file.extension] ?? null })
      this.rootEl.focus({ preventScroll: true })
    } catch (error) {
      if (id !== this.loadId) return
      if (error instanceof ImportError) {
        this.show({ kind: 'message', text: error.message, error: true })
      } else {
        console.error(error)
        this.show({ kind: 'message', text: `${file.name} could not be read.`, error: true })
      }
    }
  }

  async onUnloadFile() {
    this.loadId += 1
    this.loaded = null
    this.root?.render(null)
    await this.plugin.store.flush()
  }

  async onClose() {
    this.root?.unmount()
    this.root = null
  }

  private onIndex = (index: number) => {
    if (!this.file || !this.loaded) return
    this.loaded.index = index
    this.plugin.store.setPlace(this.file.path, index)
  }

  private exit = async () => {
    const file = this.file
    const loaded = this.loaded
    if (!file) return
    await this.plugin.store.flush()
    if (file.extension !== 'md') {
      await this.leaf.openFile(file)
      return
    }
    const state: Record<string, unknown> = { file: file.path }
    if (this.back.mode !== undefined) state.mode = this.back.mode
    if (this.back.source !== undefined) state.source = this.back.source
    await this.leaf.setViewState({ type: 'markdown', state, active: true })
    const view = this.leaf.view
    if (loaded?.paragraphLines && view instanceof MarkdownView) {
      scrollToLine(view, lineAtWord(loaded.doc, loaded.paragraphLines, loaded.index))
    }
  }

  private show(screen: Screen) {
    this.root ??= createRoot(this.rootEl)
    this.root.render(
      screen.kind === 'message' ? (
        <p className="pc-message" data-error={screen.error || undefined} role={screen.error ? 'alert' : 'status'}>
          {screen.text}
        </p>
      ) : (
        <ReaderScreen
          key={this.loadId}
          doc={screen.doc}
          title={screen.title}
          initialIndex={screen.index}
          store={this.plugin.store}
          keyTarget={this.rootEl}
          exitLabel={screen.exitLabel}
          onIndex={this.onIndex}
          onExit={this.exit}
        />
      ),
    )
  }
}

function scrollToLine(view: MarkdownView, line: number) {
  if (view.getMode() === 'source') {
    const at = { line, ch: 0 }
    view.editor.setCursor(at)
    view.editor.scrollIntoView({ from: at, to: at }, true)
  } else {
    view.previewMode.applyScroll(line)
  }
}
