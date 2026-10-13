import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, basename, join } from 'node:path'
import { CARD_FILES, MANIFEST_VERSION } from './config.js'
import { validateAll, validateOne } from './validate.js'

/** 배포 파일명에 붙는 내용 해시. pull 할 때 로컬 파일과 비교하는 데도 쓴다. */
export const contentHash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8)

function hashedName(file, buf) {
  const ext = extname(file)
  return `${basename(file, ext)}.${contentHash(buf)}${ext}`
}

/** 카드 하나를 해시 파일명으로 복사하고 manifest 항목을 돌려준다. */
function buildCard(contentDir, outDir, slug, meta) {
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
}

function writeManifest(outDir, cards) {
  const manifest = { version: MANIFEST_VERSION, cards }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  const size = statSync(join(outDir, 'manifest.json')).size
  console.log(`\nmanifest.json 생성 완료 (카드 ${cards.length}개, ${size} bytes) -> ${outDir}`)
  return manifest
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

  const cards = results.map(({ slug, meta }) => buildCard(contentDir, outDir, slug, meta))
  return writeManifest(outDir, cards)
}

/**
 * 카드 하나만 빌드한다. manifest 는 서버의 카드 목록(remoteCards)에서 이 카드 항목만 바꿔 끼워서 만든다.
 * outDir 에는 이 카드의 파일과 manifest.json 만 남으므로 그대로 deploy 하면 다른 카드는 서버 상태 그대로 유지된다.
 */
export function buildOne({ contentDir, outDir, slug, remoteCards = [] }) {
  const { ok, meta } = validateOne(contentDir, slug)
  if (!ok) throw new Error('검증에 실패했어요. 위 [error] 를 먼저 고쳐주세요.')

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const card = buildCard(contentDir, outDir, slug, meta)
  // 전체 빌드와 같은 순서(slug 순)로 맞춘다
  const cards = [...remoteCards.filter((c) => c.slug !== slug), card]
  cards.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  return writeManifest(outDir, cards)
}
