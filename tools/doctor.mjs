#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const findings = { pass: [], warn: [], fail: [] }

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

function add(kind, code, message) {
  findings[kind].push({ code, message })
}

function checkFile(relativePath) {
  if (existsSync(resolve(root, relativePath))) {
    add('pass', 'FILE_PRESENT', relativePath)
  } else {
    add('fail', 'FILE_MISSING', `Arquivo obrigatório ausente: ${relativePath}`)
  }
}

function checkEnvironment() {
  const candidates = ['.env.development.local', '.env.local']
  const selected = candidates.find((file) => existsSync(resolve(root, file)))
  if (!selected) {
    add('fail', 'ENV_MISSING', 'Nenhum .env.development.local ou .env.local foi encontrado.')
    return
  }

  const content = read(selected)
  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
  const missing = required.filter((key) => !new RegExp(`^${key}=.+`, 'm').test(content))
  if (missing.length) {
    add('fail', 'ENV_SUPABASE_MISSING', `${selected} não define: ${missing.join(', ')}`)
  } else {
    add('pass', 'ENV_SUPABASE_READY', `${selected} contém as chaves públicas necessárias.`)
  }
}

function checkWsodRisks() {
  const app = read('src/App.jsx')
  const protectedRoute = read('src/routes/ProtectedRoute.jsx')
  const auth = read('src/contexts/AuthContext.jsx')
  const consoleGuard = read('src/utils/consoleGuard.js')
  const viteConfig = read('vite.config.js')

  if (!app.includes('<Route path="*"')) {
    add('fail', 'WSOD_ROUTE_FALLBACK_MISSING', 'Não há rota curinga (*); URLs desconhecidas podem renderizar uma tela vazia.')
  } else {
    add('pass', 'WSOD_ROUTE_FALLBACK_READY', 'A aplicação possui fallback para rotas desconhecidas.')
  }

  const authCanStayBooting = auth.includes("setAuthStatus('booting')")
    && protectedRoute.includes("authStatus === 'booting'")
    && protectedRoute.includes('return null')
  if (authCanStayBooting) {
    add('fail', 'WSOD_AUTH_BOOT_STALL', 'Falha na sessão pode manter authStatus=booting e uma rota protegida retorna null sem limite de tempo.')
  } else {
    add('pass', 'WSOD_AUTH_BOOT_READY', 'A inicialização de sessão não deixa rota protegida vazia indefinidamente.')
  }

  if (consoleGuard.includes('console.error = noop')) {
    add('warn', 'PROD_ERRORS_MUTED', 'console.error é desativado em produção; um incidente visual perde evidência no navegador.')
  } else {
    add('pass', 'PROD_ERRORS_VISIBLE', 'Erros de produção permanecem observáveis no console.')
  }

  if (viteConfig.includes('skipWaiting: true') && viteConfig.includes('clientsClaim: true')) {
    add('warn', 'PWA_AGGRESSIVE_ACTIVATION', 'PWA usa skipWaiting + clientsClaim; valide atualizações para evitar incompatibilidade entre HTML e chunks em cache.')
  } else {
    add('pass', 'PWA_ACTIVATION_SAFE', 'Configuração PWA não usa ativação agressiva simultânea.')
  }
}

function runNpmCommand(label, npmArgs) {
  const isWindows = process.platform === 'win32'
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm'
  const commandArgs = isWindows ? ['/d', '/s', '/c', 'npm.cmd', ...npmArgs] : npmArgs
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8' })
  if (result.status === 0) {
    add('pass', `${label}_PASS`, `${label} executado com sucesso.`)
  } else {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-1)[0]
    add('fail', `${label}_FAIL`, `${label} falhou${detail ? `: ${detail}` : '.'}`)
  }
}

async function checkDevServer() {
  const urlArgument = [...args].find((arg) => arg.startsWith('--url='))
  const baseUrl = (urlArgument?.slice('--url='.length) || 'http://127.0.0.1:5173').replace(/\/$/, '')
  try {
    const sourceResponse = await fetch(`${baseUrl}/src/hooks/useUpdateCheck.js`, { headers: { Accept: 'application/javascript' } })
    const source = await sourceResponse.text()
    if (!sourceResponse.ok || !source.includes('@vite-plugin-pwa/virtual:pwa-register/react')) {
      add('fail', 'DEV_PWA_VIRTUAL_IMPORT_UNRESOLVED', `O Vite em ${baseUrl} não transformou o import virtual do PWA.`)
      return
    }

    const virtualResponse = await fetch(`${baseUrl}/@vite-plugin-pwa/virtual:pwa-register/react`, { headers: { Accept: 'application/javascript' } })
    const virtualModule = await virtualResponse.text()
    const contentType = virtualResponse.headers.get('content-type') || ''
    if (!virtualResponse.ok || !contentType.includes('javascript') || !virtualModule.includes('useRegisterSW')) {
      add('fail', 'DEV_PWA_VIRTUAL_MODULE_UNAVAILABLE', `O módulo virtual PWA não está disponível como JavaScript em ${baseUrl}.`)
      return
    }
    add('pass', 'DEV_PWA_VIRTUAL_MODULE_READY', `Vite em ${baseUrl} resolve virtual:pwa-register/react.`)
  } catch (error) {
    add('warn', 'DEV_SERVER_UNAVAILABLE', `Não foi possível verificar ${baseUrl}: ${error.message}`)
  }
}

for (const file of ['package.json', 'vite.config.js', 'eslint.config.js', 'index.html', 'src/main.jsx', 'src/App.jsx']) {
  checkFile(file)
}
checkEnvironment()
checkWsodRisks()

if (args.has('--dev')) await checkDevServer()

if (args.has('--build') || args.has('--full')) {
  runNpmCommand('BUILD', ['run', 'build'])
}
if (args.has('--lint') || args.has('--full')) {
  runNpmCommand('LINT', ['run', 'lint'])
}

for (const kind of ['pass', 'warn', 'fail']) {
  const label = kind === 'pass' ? 'OK' : kind === 'warn' ? 'AVISO' : 'FALHA'
  for (const finding of findings[kind]) console.log(`[${label}] ${finding.code} — ${finding.message}`)
}

const summary = `Doctor: ${findings.pass.length} ok, ${findings.warn.length} avisos, ${findings.fail.length} falhas.`
console.log(summary)
process.exitCode = findings.fail.length ? 1 : 0
