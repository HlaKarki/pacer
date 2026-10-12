import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // The word-frequency table is one deliberate ~530 kB chunk that loads lazily.
  build: { chunkSizeWarningLimit: 600 },
})
