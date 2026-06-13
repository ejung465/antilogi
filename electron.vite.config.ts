import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // node-mac-permissions is an optionalDependency (kept out of the main
        // dependency set so its space-path gyp quirk can't fail `npm install`),
        // so externalizeDepsPlugin doesn't auto-externalize it. It loads its
        // native .node via a dynamic require that rollup cannot bundle, so it
        // must stay external and be required from node_modules at runtime.
        external: ['node-mac-permissions']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
