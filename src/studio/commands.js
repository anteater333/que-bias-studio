import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CLI_PATH = fileURLToPath(new URL('../cli.js', import.meta.url))

// 웹에서 실행할 수 있는 명령과 옵션. 터미널에서 npm run 하는 것과 똑같이 cli.js 를 띄운다
const COMMANDS = {
  deploy: ['dryRun', 'force'],
  pull: ['dryRun', 'force'],
}
const FLAGS = { dryRun: '--dry-run', force: '--force' }

/**
 * POST /api/commands/:name 처리. 출력은 한 줄에 JSON 하나(NDJSON)로 흘려보낸다.
 *   { "stream": "out" | "err", "text": "..." }  ...  { "exit": 0 }
 * 배포가 두 개 동시에 돌면 manifest 가 꼬일 수 있어서 한 번에 하나만 실행한다.
 */
export function createCommandRunner() {
  let running = null

  return (name, options, res) => {
    const allowed = COMMANDS[name]
    if (!allowed) return { status: 404, body: { error: 'not found' } }
    if (running) return { status: 409, body: { errors: [`이미 실행 중인 명령이 있어요: ${running}`] } }

    const flags = allowed.filter((key) => options?.[key] === true).map((key) => FLAGS[key])
    running = name
    console.log(`[studio] ${name} ${flags.join(' ')}`.trimEnd())

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' })
    // 브라우저 탭을 닫아도 배포는 끝까지 돌도록 자식 프로세스는 건드리지 않고 쓰기만 멈춘다
    const send = (obj) => res.writableEnded || res.destroyed || res.write(JSON.stringify(obj) + '\n')

    // stdin 은 막아둔다. ssh 가 비밀번호를 물어야 하면 기다리지 않고 실패하도록 (키/agent 필요)
    const child = spawn(process.execPath, [CLI_PATH, name, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8').on('data', (text) => send({ stream: 'out', text }))
    child.stderr.setEncoding('utf8').on('data', (text) => send({ stream: 'err', text }))

    const finish = (code, error) => {
      if (running !== name) return
      running = null
      if (error) send({ stream: 'err', text: `\n실행 실패: ${error.message}\n` })
      send({ exit: code })
      res.end()
    }
    child.on('error', (e) => finish(1, e))
    child.on('close', (code) => finish(code ?? 1))
    return null
  }
}
