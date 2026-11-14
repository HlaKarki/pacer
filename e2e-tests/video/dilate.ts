// Slows every clock a page script can read by K, so frames can be captured slower than real time and still land on exact 60 fps times.
export function dilate(K: number) {
  const g = globalThis as typeof globalThis & { __dilated?: number }
  if (g.__dilated) return
  g.__dilated = K
  const realNow = performance.now.bind(performance)
  const t0 = realNow()
  const vnow = () => t0 + (realNow() - t0) / K
  performance.now = vnow
  const realDateNow = Date.now
  const d0 = realDateNow()
  Date.now = () => d0 + (realDateNow() - d0) / K
  const st = g.setTimeout.bind(g)
  const si = g.setInterval.bind(g)
  g.setTimeout = ((f: TimerHandler, ms = 0, ...a: unknown[]) => st(f, ms * K, ...a)) as typeof setTimeout
  g.setInterval = ((f: TimerHandler, ms = 0, ...a: unknown[]) => si(f, ms * K, ...a)) as typeof setInterval
  const raf = g.requestAnimationFrame.bind(g)
  g.requestAnimationFrame = (cb: FrameRequestCallback) => raf(() => cb(vnow()))
}
