import type { UserConfig } from 'tsdown'

const external = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings-plugins', '@deepseek-ai/dsh-client-ui-slots',
]

const config: UserConfig = {
  name: '@lemoncat7/dsh-web-search/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: false,
  deps: { neverBundle: external },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@lemoncat7/dsh-web-search", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default config
