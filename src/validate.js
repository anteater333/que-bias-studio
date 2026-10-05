import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CARD_FILES, CARD_VIEWBOX, META_FILE, MOTION_WARN_BYTES, OPTIONAL_CARD_FILES, SLUG_PATTERN } from './config.js'

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0

// description 은 리치 텍스트 에디터가 만든 HTML. 앱에서 그대로 렌더링하므로 스크립트가 섞이면 안 됨
const UNSAFE_HTML = /<\s*(script|style|iframe|object|embed)\b|\son\w+\s*=|javascript:/i

/** meta.json 내용을 검사해서 에러 메시지 배열을 돌려준다. */
export function validateMeta(meta) {
  const errors = []
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    return ['meta.json 최상위는 객체여야 해요']
  }
  for (const key of ['nameKo', 'nameEn', 'description']) {
    if (!isNonEmptyString(meta[key])) errors.push(`meta.${key} 는 비어있지 않은 문자열이어야 해요`)
  }
  if (typeof meta.description === 'string') {
    if (!meta.description.replace(/<[^>]*>|&nbsp;/g, '').trim()) {
      errors.push('meta.description 에 글자가 하나도 없어요')
    }
    if (UNSAFE_HTML.test(meta.description)) {
      errors.push('meta.description 에 script/이벤트 핸들러 같은 허용되지 않는 HTML 이 있어요')
    }
  }
  if (!Array.isArray(meta.recommendedTracks)) {
    errors.push('meta.recommendedTracks 는 배열이어야 해요')
  } else {
    meta.recommendedTracks.forEach((t, i) => {
      if (!isNonEmptyString(t?.title)) errors.push(`recommendedTracks[${i}].title 이 필요해요`)
      if (t?.url !== undefined && !/^https?:\/\//.test(t.url)) {
        errors.push(`recommendedTracks[${i}].url 은 http(s) 주소여야 해요`)
      }
    })
  }
  // 추천 영상은 선택 필드. 영상은 링크가 없으면 의미가 없어서 url 까지 필수
  if (meta.recommendedVideos !== undefined) {
    if (!Array.isArray(meta.recommendedVideos)) {
      errors.push('meta.recommendedVideos 는 배열이어야 해요')
    } else {
      meta.recommendedVideos.forEach((v, i) => {
        if (!isNonEmptyString(v?.title)) errors.push(`recommendedVideos[${i}].title 이 필요해요`)
        if (typeof v?.url !== 'string' || !/^https?:\/\//.test(v.url)) {
          errors.push(`recommendedVideos[${i}].url 은 http(s) 주소여야 해요`)
        }
      })
    }
  }
  return errors
}

/** 카드 폴더 하나를 검사해서 { errors, warnings, meta } 를 돌려준다. */
export function validateCard(contentDir, slug) {
  const errors = []
  const warnings = []
  const dir = join(contentDir, slug)

  if (!SLUG_PATTERN.test(slug)) {
    errors.push('폴더명(slug)은 소문자/숫자/하이픈만 쓸 수 있고 소문자나 숫자로 시작해야 해요')
  }

  const requiredFiles = Object.entries(CARD_FILES)
    .filter(([key]) => !OPTIONAL_CARD_FILES.has(key))
    .map(([, file]) => file)
  for (const file of [...requiredFiles, META_FILE]) {
    if (!existsSync(join(dir, file))) errors.push(`${file} 파일이 없어요`)
  }

  let meta = null
  if (existsSync(join(dir, META_FILE))) {
    try {
      meta = JSON.parse(readFileSync(join(dir, META_FILE), 'utf8'))
      errors.push(...validateMeta(meta))
    } catch (e) {
      errors.push(`meta.json 파싱 실패: ${e.message}`)
    }
  }

  // 이미지 위에 겹쳐지는 svg 레이어는 Que 카드와 같은 좌표계(viewBox)를 써야 위치가 맞음
  for (const key of ['deco', 'title']) {
    const file = join(dir, CARD_FILES[key])
    if (!existsSync(file)) continue
    const m = readFileSync(file, 'utf8').match(/viewBox\s*=\s*["']([^"']+)["']/)
    if (!m) errors.push(`${CARD_FILES[key]} 에 viewBox 가 없어요`)
    else if (m[1].trim().replace(/[\s,]+/g, ' ') !== CARD_VIEWBOX) {
      warnings.push(`${CARD_FILES[key]} 의 viewBox(${m[1].trim()}) 가 카드 기준(${CARD_VIEWBOX}) 과 달라요`)
    }
  }

  const motion = join(dir, CARD_FILES.motion)
  if (existsSync(motion) && statSync(motion).size > MOTION_WARN_BYTES) {
    const mb = (statSync(motion).size / 1024 / 1024).toFixed(1)
    warnings.push(`image-motion.webp 가 ${mb}MB 예요 (경고 기준 ${MOTION_WARN_BYTES / 1024 / 1024}MB)`)
  }

  return { errors, warnings, meta }
}

export function listSlugs(contentDir) {
  if (!existsSync(contentDir)) {
    throw new Error(`BIAS_CONTENT_DIR 경로가 존재하지 않아요: ${contentDir}`)
  }
  return readdirSync(contentDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
}

/** 전체 카드를 검사하고 결과를 출력한다. 에러가 하나라도 있으면 false. */
export function validateAll(contentDir) {
  const slugs = listSlugs(contentDir)
  if (slugs.length === 0) {
    console.error(`카드 폴더가 하나도 없어요: ${contentDir}`)
    return { ok: false, results: [] }
  }

  let ok = true
  const results = []
  for (const slug of slugs) {
    const result = validateCard(contentDir, slug)
    results.push({ slug, ...result })
    const mark = result.errors.length ? '✗' : '✓'
    console.log(`${mark} ${slug}`)
    for (const e of result.errors) console.log(`    [error] ${e}`)
    for (const w of result.warnings) console.log(`    [warn]  ${w}`)
    if (result.errors.length) ok = false
  }
  return { ok, results }
}
