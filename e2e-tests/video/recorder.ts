// Captures what a page shows and stamps each frame with the midpoint of its capture, in real seconds.
import type { CDPSession } from 'playwright'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export class Recorder {
  private frames: { file: string; t: number; probe?: unknown }[] = []
  private marks: Record<string, number> = {}
  private data: Record<string, unknown> = {}
  private running = false
  private paused = false
  private loop?: Promise<void>
  constructor(
    private cdp: CDPSession,
    private dir: string,
    private K: number,
    private size = { width: 1280, height: 720, scale: 2 },
    // With fps set, each capture waits for the next tick of page time, so frames land on 60 fps times.
    private opts: { fps?: number; probe?: () => Promise<unknown> } = {},
  ) {}

  now() { return performance.now() / 1000 }
  mark(name: string, data?: unknown) {
    this.marks[name] = this.now()
    if (data !== undefined) this.data[name] = data
  }
  pause() { this.paused = true }
  resume() { this.paused = false }

  async start() {
    await rm(this.dir, { recursive: true, force: true })
    await mkdir(this.dir, { recursive: true })
    this.running = true
    this.mark('start')
    this.loop = (async () => {
      let n = 0
      const tick = this.opts.fps ? this.K / this.opts.fps : 0
      let next = this.now()
      let half = 0.035
      while (this.running) {
        if (this.paused) {
          await Bun.sleep(5)
          next = this.now()
          continue
        }
        if (tick) {
          const wait = next - half - this.now()
          if (wait > 0) await Bun.sleep(wait * 1000)
        }
        // The clip is measured from the top of the document, so it has to follow the scroll to film what is on screen.
        const { cssVisualViewport: vp } = await this.cdp.send('Page.getLayoutMetrics')
        const clip = { x: vp.pageX, y: vp.pageY, ...this.size }
        const before = this.now()
        const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png', clip })
        const after = this.now()
        half = half * 0.8 + ((after - before) / 2) * 0.2
        const file = `f${String(n++).padStart(5, '0')}.png`
        const probe = this.opts.probe ? await this.opts.probe().catch(() => null) : undefined
        this.frames.push({ file, t: (before + after) / 2, ...(probe !== undefined ? { probe } : {}) })
        void Bun.write(join(this.dir, file), Buffer.from(data, 'base64'))
        if (tick) {
          next += tick
          while (next < this.now()) next += tick
        }
      }
    })()
  }

  async stop() {
    this.running = false
    await this.loop
    await writeFile(join(this.dir, 'log.json'), JSON.stringify({ K: this.K, marks: this.marks, data: this.data, frames: this.frames }))
    const dts = this.frames.slice(1).map((f, i) => ((f.t - this.frames[i]!.t) / this.K) * 1000).filter((d) => d < 100)
    return { frames: this.frames.length, maxGapMs: Math.max(...dts), avgGapMs: dts.reduce((a, b) => a + b, 0) / dts.length }
  }
}
