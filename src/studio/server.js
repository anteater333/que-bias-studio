import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CARD_FILES, META_FILE } from '../config.js'
import { listSlugs, validateCard, validateMeta } from '../validate.js'

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url))
const MAX_BODY_BYTES = 1024 * 1024

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('요청이 너무 커요'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 미리보기와 편집에 필요한 카드 정보를 한 번에 모은다. */
function readCard(contentDir, slug) {
  const dir = join(contentDir, slug)
  const { errors, warnings } = validateCard(contentDir, slug)

  let meta = null
  if (existsSync(join(dir, META_FILE))) {
    try {
      meta = JSON.parse(readFileSync(join(dir, META_FILE), 'utf8'))
    } catch {
      // 파싱 에러는 validateCard 의 errors 에 이미 들어가 있음
    }
  }

  // 파일이 바뀌면 브라우저 캐시를 우회하도록 mtime 을 같이 내려준다
  const files = {}
  for (const [key, file] of Object.entries(CARD_FILES)) {
    const path = join(dir, file)
    files[key] = existsSync(path) ? { name: file, version: statSync(path).mtimeMs } : { name: file, version: null }
  }

  // deco/title 은 currentColor 를 상속받도록 <img> 대신 인라인으로 그리기 때문에 내용을 같이 보낸다
  const svg = {}
  for (const key of ['deco', 'title']) {
    const path = join(dir, CARD_FILES[key])
    svg[key] = existsSync(path) ? readFileSync(path, 'utf8') : null
  }

  return { slug, meta, files, svg, errors, warnings }
}

/** 카드 폴더 변경을 SSE 로 알려준다. 디자이너가 svg/webp 를 저장하면 미리보기가 바로 갱신됨. */
function createWatcher(contentDir) {
  const clients = new Set()
  const timers = new Map()

  const broadcast = (slug) => {
    for (const res of clients) res.write(`data: ${JSON.stringify({ slug })}\n\n`)
  }

  watch(contentDir, { recursive: true }, (_event, filename) => {
    const slug = filename ? String(filename).split(/[\\/]/)[0] : null
    // 에디터들이 저장할 때 이벤트를 여러 번 쏘므로 묶어서 한 번만 보낸다
    clearTimeout(timers.get(slug))
    timers.set(
      slug,
      setTimeout(() => {
        timers.delete(slug)
        broadcast(slug)
      }, 150),
    )
  })

  return (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
  }
}

export function startStudio({ contentDir, studioPort }) {
  // 원재료 폴더는 git 에 없어서 처음엔 비어있는 게 정상. studio 에서만 만들어준다
  // (validate/build 에선 경로 오타일 가능성이 커서 그대로 에러를 낸다)
  if (!existsSync(contentDir)) {
    mkdirSync(contentDir, { recursive: true })
    console.log(`카드 폴더가 없어서 새로 만들었어요: ${contentDir}`)
  }
  const handleEvents = createWatcher(contentDir)
  const publicFiles = new Set(readdirSync(PUBLIC_DIR))

  // slug 는 실제 존재하는 하위 폴더 이름만 허용 (경로 조작 방지)
  const resolveSlug = (raw) => {
    const slug = decodeURIComponent(raw)
    return listSlugs(contentDir).includes(slug) ? slug : null
  }

  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost')
      const parts = pathname.split('/').filter(Boolean)

      if (parts[0] !== 'api') {
        const file = parts.length === 0 ? 'index.html' : parts.join('/')
        if (!publicFiles.has(file)) return sendJson(res, 404, { error: 'not found' })
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)], 'Cache-Control': 'no-store' })
        return createReadStream(join(PUBLIC_DIR, file)).pipe(res)
      }

      if (parts[1] === 'events') return handleEvents(req, res)

      if (parts[1] === 'cards' && parts.length === 2 && req.method === 'GET') {
        const cards = listSlugs(contentDir).map((slug) => {
          const { errors, warnings } = validateCard(contentDir, slug)
          return { slug, errors: errors.length, warnings: warnings.length }
        })
        return sendJson(res, 200, { contentDir, cards })
      }

      if (parts[1] === 'cards' && parts.length >= 3) {
        const slug = resolveSlug(parts[2])
        if (!slug) return sendJson(res, 404, { error: `카드 폴더가 없어요: ${parts[2]}` })

        if (parts.length === 3 && req.method === 'GET') {
          return sendJson(res, 200, readCard(contentDir, slug))
        }

        if (parts[3] === 'meta' && req.method === 'PUT') {
          let meta
          try {
            meta = JSON.parse(await readBody(req))
          } catch {
            return sendJson(res, 400, { errors: ['요청 본문이 올바른 JSON 이 아니에요'] })
          }
          const errors = validateMeta(meta)
          if (errors.length) return sendJson(res, 422, { errors })
          writeFileSync(join(contentDir, slug, META_FILE), JSON.stringify(meta, null, 2) + '\n')
          return sendJson(res, 200, readCard(contentDir, slug))
        }

        if (parts[3] === 'files' && parts[4] && req.method === 'GET') {
          const file = CARD_FILES[parts[4]]
          const path = file && join(contentDir, slug, file)
          if (!path || !existsSync(path)) return sendJson(res, 404, { error: 'not found' })
          // 클라이언트가 ?v=mtime 을 붙여서 요청하므로, 파일이 바뀌면 URL 이 바뀐다 -> 캐시해도 안전
          res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)], 'Cache-Control': 'private, max-age=3600' })
          return createReadStream(path).pipe(res)
        }
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (e) {
      sendJson(res, 500, { errors: [e.message] })
    }
  })

  server.on('error', (e) => {
    console.error(
      e.code === 'EADDRINUSE'
        ? `\n오류: ${studioPort} 포트를 이미 쓰고 있어요. BIAS_STUDIO_PORT 로 다른 포트를 지정해주세요.`
        : `\n오류: ${e.message}`,
    )
    process.exit(1)
  })
  server.listen(studioPort, '127.0.0.1', () => {
    console.log(`최애 제작소가 열렸어요 -> http://localhost:${studioPort}`)
    console.log(`카드 폴더: ${contentDir}`)
    console.log('종료하려면 Ctrl+C')
  })
  return server
}
