import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CARD_FILES, META_FILE, MOTION_WARN_BYTES, SLUG_PATTERN } from './config.js'

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0

function validateMeta(meta) {
  const errors = []
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    return ['meta.json 최상위는 객체여야 해요']
  }
  for (const key of ['nameKo', 'nameEn', 'description']) {
    if (!isNonEmptyString(meta[key])) errors.push(`meta.${key} 는 비어있지 않은 문자열이어야 해요`)
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

  for (const file of [...Object.values(CARD_FILES), META_FILE]) {
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

  // 세 레이어가 같은 좌표계(viewBox)를 공유하므로 svg 에는 viewBox 가 있어야 함
  const viewBoxes = {}
  for (const key of ['deco', 'title']) {
    const file = join(dir, CARD_FILES[key])
    if (!existsSync(file)) continue
    const m = readFileSync(file, 'utf8').match(/viewBox\s*=\s*["']([^"']+)["']/)
    if (!m) errors.push(`${CARD_FILES[key]} 에 viewBox 가 없어요`)
    else viewBoxes[key] = m[1].trim().replace(/\s+/g, ' ')
  }
  if (viewBoxes.deco && viewBoxes.title && viewBoxes.deco !== viewBoxes.title) {
    warnings.push(
      `deco.svg(${viewBoxes.deco}) 와 title.svg(${viewBoxes.title}) 의 viewBox 가 달라요 (의도한 게 맞나요?)`,
    )
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
