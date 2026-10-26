// Copies what the extension runs from the repository into ./runtime: the note format and store, the web
// notebook's server and page. The layout matches the repository's, so the server's own relative imports hold.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const runtime = join(here, '..', 'runtime')

rmSync(runtime, { recursive: true, force: true })
for (const path of ['src/core', 'src/services/export-markdown.mjs', 'src/services/export-markdown.d.mts', 'server/notebook-server.mjs', 'web']) {
  mkdirSync(dirname(join(runtime, path)), { recursive: true })
  cpSync(join(repo, path), join(runtime, path), { recursive: true })
}
// The notebook's own version, so a server this extension starts and one Claude Code starts agree on which is newer.
const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
writeFileSync(join(runtime, 'package.json'), `${JSON.stringify({ name: 'live-notebook-runtime', private: true, version, type: 'module' }, null, 2)}\n`)
console.log(`Bundled the notebook ${version} into ${runtime}`)
