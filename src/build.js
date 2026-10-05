import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, basename, join } from 'node:path'
import { CARD_FILES, MANIFEST_VERSION } from './config.js'
import { validateAll } from './validate.js'

function hashedName(file, buf) {
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 8)
  const ext = extname(file)
  return `${basename(file, ext)}.${hash}${ext}`
}

/**
 * 검증 -> 해시 파일명으로 복사 -> manifest.json 생성.
 * 같은 입력이면 항상 같은 산출물이 나온다 (해시가 내용 기반이라 재배포해도 URL 이 안 바뀜).
 */
export function build({ contentDir, outDir }) {
  const { ok, results } = validateAll(contentDir)
  if (!ok) throw new Error('검증에 실패했어요. 위 [error] 를 먼저 고쳐주세요.')

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const cards = results.map(({ slug, meta }) => {
    const cardOut = join(outDir, slug)
    mkdirSync(cardOut, { recursive: true })

    const files = {}
    for (const [key, file] of Object.entries(CARD_FILES)) {
      const src = join(contentDir, slug, file)
      if (!existsSync(src)) continue // 검증을 통과했으니 없는 건 선택 파일뿐
      const name = hashedName(file, readFileSync(src))
      copyFileSync(src, join(cardOut, name))
      files[key] = `${slug}/${name}`
    }
    return { slug, ...meta, ...files }
  })

  const manifest = { version: MANIFEST_VERSION, cards }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  const size = statSync(join(outDir, 'manifest.json')).size
  console.log(`\nmanifest.json 생성 완료 (카드 ${cards.length}개, ${size} bytes) -> ${outDir}`)
  return manifest
}
