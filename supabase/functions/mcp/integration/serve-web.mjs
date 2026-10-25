// Serves the Expo web export with a single-page-app fallback (every unknown path
// returns index.html), as Cloudflare Pages does. Local only: binds 127.0.0.1.
//   node serve-web.mjs <dist dir> [port]
import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const [dist, port = '8081'] = process.argv.slice(2)
if (!dist) throw new Error('usage: serve-web.mjs <dist dir> [port]')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' }

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(dist, path)
  try { if (!statSync(file).isFile()) throw new Error('not a file') } catch { file = join(dist, 'index.html') }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(Number(port), '127.0.0.1')
