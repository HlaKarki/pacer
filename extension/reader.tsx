import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ExtensionStore } from './store'

const store = await ExtensionStore.load()
createRoot(document.getElementById('root')!).render(
  <App store={store} docId={new URLSearchParams(location.search).get('doc')} />,
)
