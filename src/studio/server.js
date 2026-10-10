import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CARD_FILES, META_FILE, OPTIONAL_CARD_FILES, SLUG_PATTERN } from '../config.js'
import { listSlugs, validateCard, validateMeta } from '../validate.js'
import { createCommandRunner } from './commands.js'

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url))
const MAX_BODY_BYTES = 1024 * 1024
// 움짤은 경고 기준(6MB)을 넘어도 올릴 수는 있어야 해서 넉넉하게
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

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

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('요청이 너무 커요'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
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
    const stat = existsSync(path) ? statSync(path) : null
    files[key] = { name: file, optional: OPTIONAL_CARD_FILES.has(key), version: stat?.mtimeMs ?? null, size: stat?.size ?? null }
  }

  // deco/title 은 currentColor 를 상속받도록 <img> 대신 인라인으로 그리기 때문에 내용을 같이 보낸다
  const svg = {}
  for (const key of ['deco', 'title']) {
    const path = join(dir, CARD_FILES[key])
    svg[key] = existsSync(path) ? readFileSync(path, 'utf8') : null
  }

  return { slug, meta, files, svg, errors, warnings }
}

// svg 는 스튜디오에선 정리해서 그리지만, Que 앱이 어떻게 그릴지 모르니 애초에 받지 않는다
const UNSAFE_SVG = /<\s*(script|foreignObject)\b|\son\w+\s*=|javascript:/i

/** 올린 파일이 확장자에 맞는 내용인지 확인. 문제가 있으면 에러 메시지를 돌려준다. */
function checkUpload(file, buf) {
  if (buf.length === 0) return '빈 파일이에요'
  if (extname(file) === '.webp') {
    const isWebp = buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
    return isWebp ? null : `${file} 자리에는 webp 파일만 올릴 수 있어요`
  }
  if (extname(file) === '.svg') {
    const text = buf.toString('utf8')
    if (!/<svg[\s>]/i.test(text)) return `${file} 자리에는 svg 파일만 올릴 수 있어요`
    if (UNSAFE_SVG.test(text)) return `${file} 에 script/이벤트 핸들러가 들어있어요`
  }
  return null
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

export function startStudio({ contentDir, deployTarget, studioPort }) {
  // 원재료 폴더는 git 에 없어서 처음엔 비어있는 게 정상. studio 에서만 만들어준다
  // (validate/build 에선 경로 오타일 가능성이 커서 그대로 에러를 낸다)
  if (!existsSync(contentDir)) {
    mkdirSync(contentDir, { recursive: true })
    console.log(`카드 폴더가 없어서 새로 만들었어요: ${contentDir}`)
  }
  const handleEvents = createWatcher(contentDir)
  const runCommand = createCommandRunner()
  const publicFiles = new Set(readdirSync(PUBLIC_DIR))
  // 다른 사이트가 DNS 리바인딩/폼 전송으로 로컬 API 를 건드리지 못하게 한다
  const allowedHosts = new Set([`localhost:${studioPort}`, `127.0.0.1:${studioPort}`])
  const isAllowedOrigin = (origin) => {
    try {
      return allowedHosts.has(new URL(origin).host)
    } catch {
      return false
    }
  }

  // slug 는 실제 존재하는 하위 폴더 이름만 허용 (경로 조작 방지)
  const resolveSlug = (raw) => {
    const slug = decodeURIComponent(raw)
    return listSlugs(contentDir).includes(slug) ? slug : null
  }

  const server = createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host)) return sendJson(res, 403, { error: 'forbidden host' })
      if (req.method !== 'GET' && req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
        return sendJson(res, 403, { error: 'forbidden origin' })
      }

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
        return sendJson(res, 200, { contentDir, deployTarget: deployTarget || null, cards })
      }

      if (parts[1] === 'commands' && parts.length === 3 && req.method === 'POST') {
        let options
        try {
          options = JSON.parse(await readBody(req))
        } catch {
          return sendJson(res, 400, { errors: ['요청 본문이 올바른 JSON 이 아니에요'] })
        }
        const rejected = runCommand(parts[2], options, res)
        return rejected && sendJson(res, rejected.status, rejected.body)
      }

      if (parts[1] === 'cards' && parts.length === 2 && req.method === 'POST') {
        let slug
        try {
          slug = JSON.parse(await readBody(req)).slug
        } catch {
          return sendJson(res, 400, { errors: ['요청 본문이 올바른 JSON 이 아니에요'] })
        }
        if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
          return sendJson(res, 422, { errors: ['폴더명(slug)은 소문자/숫자/하이픈만 쓸 수 있고 소문자나 숫자로 시작해야 해요'] })
        }
        if (existsSync(join(contentDir, slug))) return sendJson(res, 409, { errors: [`이미 있는 카드예요: ${slug}`] })
        mkdirSync(join(contentDir, slug))
        return sendJson(res, 201, readCard(contentDir, slug))
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

        if (parts[3] === 'files' && parts[4] && req.method === 'PUT') {
          const file = CARD_FILES[parts[4]]
          if (!file) return sendJson(res, 404, { error: 'not found' })
          const buf = await readBody(req, MAX_UPLOAD_BYTES)
          const error = checkUpload(file, buf)
          if (error) return sendJson(res, 422, { errors: [error] })
          // 반쯤 쓴 파일을 watcher/미리보기가 읽지 않도록 임시 파일에 쓰고 바꿔치기
          const path = join(contentDir, slug, file)
          const tmp = join(contentDir, slug, `.${file}.uploading`)
          writeFileSync(tmp, buf)
          renameSync(tmp, path)
          return sendJson(res, 200, readCard(contentDir, slug))
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
