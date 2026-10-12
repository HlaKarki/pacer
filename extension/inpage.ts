import { createInPage } from './inpage/toggle'

// Scripting results must be plain data, so Pacer injects this file once per document and then calls the global.
Object.assign(globalThis, { __pacerInPage: createInPage(window) })
