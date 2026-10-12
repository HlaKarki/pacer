export const OWN_HOST = /^pacer-/

export const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role=textbox]'

export const fromPacer = (e: Event) => e.composedPath().some((node) => OWN_HOST.test((node as Element).localName ?? ''))
