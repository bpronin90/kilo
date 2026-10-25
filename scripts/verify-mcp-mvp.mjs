#!/usr/bin/env node
// Runner for the isolated MCP integration matrix (issue #1629).
//
//   node scripts/verify-mcp-mvp.mjs --check   offline consistency check (CI-safe, no stack, no secrets)
//   node scripts/verify-mcp-mvp.mjs           run the matrix against the local stack from stack.sh and
//                                             write docs/verification/mcp-mvp/results.json
//
// The run never targets a hosted project: it reads connection details only from the
// scratch workdir that supabase/functions/mcp/integration/stack.sh created.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const integration = join(root, 'supabase/functions/mcp/integration')
const evidence = join(root, 'docs/verification/mcp-mvp')
const manifestPath = join(evidence, 'fixture-manifest.json')
const resultsPath = join(evidence, 'results.json')

export const caseIds = (source) => [...source.matchAll(/await check\('([A-Z]+\d+)'/g)].map((m) => m[1])

// Evidence must never carry credentials or protocol artifacts.
const FORBIDDEN = [
  [/eyJ[A-Za-z0-9_-]{10,}\./, 'JWT'],
  [/authorization_id=[A-Za-z0-9]{8,}/, 'authorization id'],
  [/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/, 'API key'],
  [/[?&]code=[A-Za-z0-9_-]{10,}/, 'authorization code'],
]

export function checkEvidence() {
  const problems = []
  const matrix = readFileSync(join(integration, 'matrix.ts'), 'utf8')
  const ids = caseIds(matrix)
  if (new Set(ids).size !== ids.length) problems.push('duplicate case id in matrix.ts')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const declared = manifest.cases.map((c) => c.id)
  if (JSON.stringify([...declared].sort()) !== JSON.stringify([...ids].sort())) {
    problems.push(`fixture-manifest cases ${declared.join(',')} differ from matrix ${ids.join(',')}`)
  }
  if (existsSync(resultsPath)) {
    const results = JSON.parse(readFileSync(resultsPath, 'utf8'))
    const got = results.cases.map((c) => c.id)
    if (JSON.stringify([...got].sort()) !== JSON.stringify([...ids].sort())) problems.push('results.json is not for the current matrix')
    for (const c of results.cases) if (c.status === 'fail') problems.push(`recorded failure ${c.id}`)
    if (!/^[0-9a-f]{40}$/.test(results.testedSha ?? '')) problems.push('results.json lacks a full tested SHA')
  }
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
  for (const file of [...walk(evidence), ...walk(integration)].filter((f) => /\.(md|json|ts|toml|sh)$/.test(f))) {
    const text = readFileSync(file, 'utf8')
    for (const [re, name] of FORBIDDEN) if (re.test(text)) problems.push(`${file.replace(root + '/', '')} contains a ${name}`)
  }
  return problems
}

function run() {
  const workdir = process.env.KILO_MCP_STACK_DIR ?? join(process.env.TMPDIR ?? tmpdir(), 'kilo-mcp-stack')
  const envFile = join(workdir, 'stack.env')
  if (!existsSync(envFile)) {
    console.error(`no stack at ${workdir}; run: bash supabase/functions/mcp/integration/stack.sh up`)
    process.exit(2)
  }
  const env = { ...process.env }
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
    if (m) env[m[1]] = m[2]
  }
  env.KILO_MCP_SIGNING_KEYS = join(workdir, 'supabase/signing_keys.json')
  env.KILO_MCP_FUNCTIONS_LOG = join(workdir, 'functions.log')
  env.KILO_MCP_RESULTS = join(workdir, 'results.raw.json')
  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim()
  const dirty = sh('git', ['status', '--porcelain', '--', 'supabase', 'scripts']) !== ''
  const sha = sh('git', ['rev-parse', 'HEAD'])
  if (dirty) console.error('warning: supabase/ or scripts/ has uncommitted changes; the recorded SHA will not describe the tested code')

  const deno = spawnSync('deno', ['run', '--config', join(integration, 'deno.json'), '--lock', join(integration, 'deno.lock'), '--frozen', '--allow-all', join(integration, 'matrix.ts')], {
    cwd: root,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (!existsSync(env.KILO_MCP_RESULTS)) process.exit(deno.status ?? 1)

  const auth = JSON.parse(execFileSync('curl', ['-s', `${env.API_URL}/auth/v1/health`, '-H', `apikey: ${env.ANON_KEY}`], { encoding: 'utf8' }))
  const cases = JSON.parse(readFileSync(env.KILO_MCP_RESULTS, 'utf8'))
  const lock = readFileSync(join(integration, 'deno.lock'), 'utf8')
  const client = lock.match(/@modelcontextprotocol\/client@([0-9.]+)/)?.[1] ?? 'unknown'
  const summary = {
    environment: 'local stack, project id kilo_mcp_staging (disposable; not production)',
    date: new Date().toISOString().slice(0, 10),
    testedSha: sha,
    testedTreeDirty: dirty,
    supabaseCli: process.env.KILO_SUPABASE_CLI_VERSION ?? '2.117.0',
    gotrue: auth.version ?? 'unknown',
    deno: sh('deno', ['--version']).split('\n')[0],
    node: process.version,
    mcpClient: `@modelcontextprotocol/client ${client} (official MCP TypeScript SDK client)`,
    passed: cases.filter((c) => c.status === 'pass').length,
    total: cases.length,
    cases,
  }
  writeFileSync(resultsPath, JSON.stringify(summary, null, 2) + '\n')
  console.log(`wrote ${resultsPath.replace(root + '/', '')}: ${summary.passed}/${summary.total}`)
  process.exit(summary.passed === summary.total ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = checkEvidence()
    if (problems.length) {
      for (const p of problems) console.error(`FAIL ${p}`)
      process.exit(1)
    }
    console.log('MCP verification evidence is consistent')
  } else {
    run()
  }
}
