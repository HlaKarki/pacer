import { useEffect, type RefObject } from 'react'

/** Closes a popover on any pointer press outside its anchor, which also holds the toggle button. */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const anchor = ref.current?.parentElement
      if (anchor && !anchor.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [ref, onClose])
}
