import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contentHash } from './build.js'
import { CARD_FILES, META_FILE, SLUG_PATTERN } from './config.js'
import { fetchRemoteFiles, fetchRemoteManifest } from './remote.js'
import { listSlugs } from './validate.js'

// 키 순서와 상관없이 같은 내용이면 같은 문자열이 나오도록
const stableStringify = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  )

/** manifest 카드 하나를 원래 폴더 구조로 되돌렸을 때의 모습 (빌드의 역연산) */
function remoteCardSource(card) {
  const files = {}
  const meta = {}
  for (const [key, value] of Object.entries(card)) {
    if (key === 'slug') continue
    if (key in CARD_FILES) {
      // 서버 경로가 카드 폴더 밖을 가리키면 받지 않는다
      if (typeof value !== 'string' || !value.startsWith(`${card.slug}/`) || value.includes('..')) {
        throw new Error(`${card.slug}: ${key} 경로가 이상해요 (${value})`)
      }
      // nell/title.4b111f47.svg -> 해시 4b111f47
      files[CARD_FILES[key]] = { remotePath: value, hash: value.split('.').at(-2) }
    } else {
      meta[key] = value
    }
  }
  return { files, meta }
}

/** 로컬 카드 폴더와 서버 카드를 비교해서 무엇을 받아야 하는지 계산한다. */
function planCard(contentDir, card) {
  if (typeof card.slug !== 'string' || !SLUG_PATTERN.test(card.slug)) {
    throw new Error(`서버 manifest 에 이상한 slug 가 있어요: ${card.slug}`)
  }
  const dir = join(contentDir, card.slug)
  const remote = remoteCardSource(card)
  const managed = [...Object.values(CARD_FILES), META_FILE]
  const isNew = !managed.some((file) => existsSync(join(dir, file)))

  const download = [] // { file, remotePath, hash }
  const remove = [] // 서버엔 없고 로컬에만 있는 카드 파일 (deco 같은 선택 파일)
  for (const file of Object.values(CARD_FILES)) {
    const local = join(dir, file)
    const localHash = existsSync(local) ? contentHash(readFileSync(local)) : null
    const r = remote.files[file]
    if (r && r.hash !== localHash) download.push({ file, ...r })
    if (!r && localHash) remove.push(file)
  }

  let localMeta = null
  try {
    localMeta = JSON.parse(readFileSync(join(dir, META_FILE), 'utf8'))
  } catch {
    // 없거나 깨졌으면 다른 것으로 취급
  }
  const metaDiffers = stableStringify(localMeta) !== stableStringify(remote.meta)

  const changed = [...download.map((d) => d.file), ...remove.map((f) => `${f} 삭제`), ...(metaDiffers ? [META_FILE] : [])]
  return { slug: card.slug, dir, isNew, changed, download, remove, meta: metaDiffers ? remote.meta : null }
}

/**
 * 서버(BIAS_DEPLOY_TARGET)에 배포된 카드를 원본 폴더 구조로 되돌려 받는다.
 * 기본은 로컬에 없는 카드만 받고, 로컬과 다른 카드는 건너뛴다 (아직 배포 안 한 작업을 덮어쓰지 않도록).
 * force 면 서버 기준으로 덮어쓴다. 로컬에만 있는 카드 폴더는 어느 경우에도 건드리지 않는다.
 */
export function pull({ contentDir, deployTarget, dryRun = false, force = false }) {
  console.log(`서버에서 manifest.json 확인 중... (${deployTarget})`)
  const manifest = fetchRemoteManifest(deployTarget)
  if (!manifest) throw new Error('서버에 manifest.json 이 없어요. 아직 한 번도 배포하지 않은 것 같아요.')

  const plans = manifest.cards.map((card) => planCard(contentDir, card))
  const apply = plans.filter((p) => p.changed.length && (p.isNew || force))
  const skipped = plans.filter((p) => p.changed.length && !p.isNew && !force)
  const remoteSlugs = new Set(plans.map((p) => p.slug))
  const localOnly = existsSync(contentDir) ? listSlugs(contentDir).filter((s) => !remoteSlugs.has(s)) : []

  console.log('')
  for (const p of plans) {
    if (!p.changed.length) console.log(`= ${p.slug}  최신 상태`)
    else if (p.isNew) console.log(`↓ ${p.slug}  새로 받음 (${p.changed.join(', ')})`)
    else if (force) console.log(`↓ ${p.slug}  서버 기준으로 덮어씀 (${p.changed.join(', ')})`)
    else console.log(`! ${p.slug}  로컬과 달라서 건너뜀 (${p.changed.join(', ')})`)
  }
  for (const slug of localOnly) console.log(`· ${slug}  로컬에만 있음 (그대로 둠)`)

  if (dryRun) {
    console.log('\ndry-run 완료 (실제로는 아무것도 받지 않았어요)')
  } else if (apply.length) {
    const tempDir = fetchRemoteFiles(
      deployTarget,
      apply.flatMap((p) => p.download.map((d) => d.remotePath)),
    )
    try {
      for (const p of apply) {
        mkdirSync(p.dir, { recursive: true })
        for (const d of p.download) {
          const buf = readFileSync(join(tempDir, d.remotePath))
          // 전송 중 깨지지 않았는지 파일명의 해시로 확인
          if (contentHash(buf) !== d.hash) throw new Error(`${d.remotePath} 내용이 해시와 달라요. 다시 시도해주세요.`)
          copyFileSync(join(tempDir, d.remotePath), join(p.dir, d.file))
        }
        for (const file of p.remove) rmSync(join(p.dir, file))
        if (p.meta) writeFileSync(join(p.dir, META_FILE), JSON.stringify(p.meta, null, 2) + '\n')
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
    console.log(`\n카드 ${apply.length}개를 받았어요 -> ${contentDir}`)
  } else {
    console.log('\n받을 카드가 없어요.')
  }

  if (skipped.length && !dryRun) {
    console.log(
      `\n로컬과 다른 카드 ${skipped.length}개는 건너뛰었어요. 서버 기준으로 덮어쓰려면: npm run pull -- --force`,
    )
  }
  return { plans, localOnly }
}

/**
 * 배포 전 확인: 서버에는 있는데 로컬에 없는 카드가 있으면 멈춘다.
 * deploy 는 로컬 카드만으로 manifest 를 새로 만들기 때문에, 그대로 올리면 그 카드들이 서비스에서 빠진다.
 */
export function checkRemoteBeforeDeploy({ contentDir, deployTarget, force = false }) {
  const manifest = fetchRemoteManifest(deployTarget)
  if (!manifest) return
  const local = new Set(listSlugs(contentDir))
  const missing = manifest.cards.map((c) => c.slug).filter((slug) => !local.has(slug))
  if (!missing.length) return

  const list = missing.map((s) => `  - ${s}`).join('\n')
  if (force) {
    console.warn(`[warn] 서버에 있는 카드 ${missing.length}개가 이번 배포에서 빠져요 (--force):\n${list}\n`)
    return
  }
  throw new Error(
    `서버에는 있는데 로컬에 없는 카드가 ${missing.length}개 있어요:\n${list}\n` +
      '그대로 배포하면 이 카드들이 서비스에서 빠져요.\n' +
      '  - 다른 PC 에서 작업한 카드라면: npm run pull 로 먼저 받아오세요\n' +
      '  - 일부러 빼는 게 맞다면: npm run deploy -- --force',
  )
}
