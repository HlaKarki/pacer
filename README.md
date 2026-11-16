# Pacer

Pacer is a speed reader that leaves the page alone. A highlighter moves through the text at the pace you set, and the words around it stay where they are. Miss a word and it's one glance back, or click it and Pacer carries on from there.

https://github.com/user-attachments/assets/9e68740b-ad96-44b5-9f0b-9556ed6787df

It comes in three forms:

- **Chrome extension.** Press the Pacer button or Alt+Shift+P on an article, and the highlighter runs on the page itself. PDFs open in a Pacer tab next to the original.
- **Obsidian plugin.** Pace a note, a PDF or an EPUB in your vault.
- **Web app** at [pacer.hla.dev](https://pacer.hla.dev). Paste text, or drop in a PDF or EPUB.

## Why not one word at a time

Most speed readers flash one word at a time in the middle of the screen. That feels fast until you blink: the missed word takes the sentence with it, and there's no paragraph to glance back at. Pacer moves your eyes through the real text instead, like running a finger under the line.

## How the pace works

You set the pace in words per minute, from 100 to 1200 (300 to start). Smart pacing gives long and rare words more time and short common words like "the" less, based on SUBTLEX-US word frequencies. Word times are scaled to the document's average, so the pace you set is the pace you read. Pause at punctuation adds a beat at the end of each sentence and paragraph.

Pacer can move 1, 2 or 3 words at a time, a phrase at a time, or a whole sentence at a time.

The Pacer tab, the Obsidian plugin and the web app have two views. Flow keeps the paragraph on screen and holds the line you're reading at a steady height. Focus shows the current words large, with their sentence underneath.

## Keys

| Key | Action |
|---|---|
| Space | Play or pause |
| ← and → | Back one word, forward one step |
| Shift+← and Shift+→ | Back or forward one sentence |
| ↑ and ↓ | 25 words per minute faster or slower |
| F | Switch between Flow and Focus (not on the page itself) |
| Esc | Pause, then press again to exit |

Click any word to jump to it.

## Chrome extension

Install Pacer from the Chrome Web Store.

- **On an article,** press the toolbar button or Alt+Shift+P. Pacer marks the first words in view and waits. Press Space or Play to start. Turn on Start on press in the bar's settings to skip the wait.
- **From the right-click menu,** choose Read with Pacer, or select some text and choose Read from here with Pacer.
- **PDFs,** and pages Pacer can't follow, open in a Pacer tab next to the original. When you exit, the original scrolls to where you stopped.
- **PDFs on your own disk** need Allow access to file URLs, which you turn on in the extension's details page.

Pacer remembers your place on each page.

## Obsidian plugin

Install Pacer from Settings, then Community plugins, then Browse. Then open a note and run Pace this file or Pace from cursor from the command palette, or choose Pace in a file's menu. EPUB files open in Pacer directly. Esc takes you back to the note at the paragraph you reached, and Pacer remembers your place in each file.

The plugin is desktop only for now.

## Privacy

Pacer has no account and no analytics, and it makes no network requests of its own. Your settings, your places and the extension's recent documents stay on your device. The full policy is at [pacer.hla.dev/privacy](https://pacer.hla.dev/privacy).

## Build from source

```sh
bun install
bun run dev              # web app with hot reload
bun run build:web        # web app into dist/
bun run build            # Obsidian plugin: main.js and styles.css
bun run build:extension  # Chrome extension into extension/dist (load unpacked)
bun test
```

`bun run version 1.2.3` sets the version in every manifest before a release. Pushing a tag with that version builds the release.

## License

MIT. The bundled fonts and libraries keep their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
