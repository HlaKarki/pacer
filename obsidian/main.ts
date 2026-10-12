import { FileView, MarkdownView, Plugin, TFile, type WorkspaceLeaf } from 'obsidian'
import { PacerStore } from './places'
import { PACEABLE } from './source'
import { PacerView, VIEW_TYPE, type BackState } from './view'

interface OpenState extends BackState {
  line?: number
}

const backOf = (view: FileView): BackState => {
  if (!(view instanceof MarkdownView)) return {}
  const { mode, source } = view.getState()
  return { mode, source }
}

function cursorLine(view: MarkdownView): number {
  if (view.getMode() === 'source') return view.editor.getCursor('head').line
  // getScroll can land a hair under the line it was scrolled to, so round near-misses up.
  return Math.floor(view.previewMode.getScroll() + 0.05)
}

export default class PacerPlugin extends Plugin {
  store!: PacerStore

  async onload() {
    this.store = new PacerStore(await this.loadData(), (data) => this.saveData(data))
    this.registerView(VIEW_TYPE, (leaf) => new PacerView(leaf, this))
    try {
      this.registerExtensions(['epub'], VIEW_TYPE)
    } catch (error) {
      // Another plugin may own .epub already, and the file menu still offers Pace.
      console.warn('Pacer could not register .epub files.', error)
    }

    this.addRibbonIcon('highlighter', 'Pace this file', () => {
      const view = this.activeFileView()
      if (view?.file) void this.open(view.file, view.leaf, backOf(view))
    })
    this.addCommand({
      id: 'pace-file',
      name: 'Pace this file',
      checkCallback: (checking) => {
        const view = this.activeFileView()
        if (!view?.file) return false
        if (!checking) void this.open(view.file, view.leaf, backOf(view))
        return true
      },
    })
    this.addCommand({
      id: 'pace-from-cursor',
      name: 'Pace from cursor',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView)
        if (!view?.file) return false
        if (!checking) void this.open(view.file, view.leaf, { ...backOf(view), line: cursorLine(view) })
        return true
      },
    })

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
        if (!(file instanceof TFile) || !PACEABLE.has(file.extension)) return
        if (leaf?.view instanceof PacerView) return
        menu.addItem((item) =>
          item
            .setTitle('Pace')
            .setIcon('highlighter')
            .onClick(() => {
              const shown = leaf?.view instanceof FileView && leaf.view.file === file ? leaf.view : null
              void this.open(file, shown?.leaf ?? this.app.workspace.getLeaf(false), shown ? backOf(shown) : {})
            }),
        )
      }),
    )
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.store.move(oldPath, file.path)))
    this.registerEvent(this.app.vault.on('delete', (file) => this.store.drop(file.path)))
  }

  onunload() {
    void this.store.flush()
  }

  /** Swaps the tab to Pacer, so the file stays one step back in the tab's history. */
  async open(file: TFile, leaf: WorkspaceLeaf, state: OpenState = {}) {
    await leaf.setViewState({ type: VIEW_TYPE, state: { ...state, file: file.path }, active: true })
  }

  private activeFileView(): FileView | null {
    const view = this.app.workspace.getActiveViewOfType(FileView)
    if (!view?.file || view instanceof PacerView || !PACEABLE.has(view.file.extension)) return null
    return view
  }
}
