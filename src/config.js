import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** .env.local 을 읽어 process.env 에 채운다 (이미 설정된 값이 우선). 의존성 없이 처리. */
function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || line.trimStart().startsWith('#')) continue
    const [, key, raw] = m
    if (process.env[key] === undefined) {
      process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2')
    }
  }
}

loadEnvFile(resolve(process.cwd(), '.env.local'))

export const MANIFEST_VERSION = 1

// 카드 폴더 안에 반드시 있어야 하는 파일 (manifest 키 -> 파일명)
export const CARD_FILES = {
  deco: 'deco.svg',
  title: 'title.svg',
  still: 'image-still.webp',
  motion: 'image-motion.webp',
}

export const META_FILE = 'meta.json'
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/

// 움짤 용량 경고 기준 (byte). 넘으면 경고만 하고 빌드는 계속함
export const MOTION_WARN_BYTES = 6 * 1024 * 1024

export function getConfig({ requireTarget = false } = {}) {
  const contentDir = process.env.BIAS_CONTENT_DIR
  if (!contentDir) {
    throw new Error(
      'BIAS_CONTENT_DIR 이 설정되지 않았어요. .env.example 을 .env.local 로 복사해서 채워주세요.',
    )
  }
  const deployTarget = process.env.BIAS_DEPLOY_TARGET
  if (requireTarget && !deployTarget) {
    throw new Error('BIAS_DEPLOY_TARGET 이 설정되지 않았어요. (.env.local 확인)')
  }
  return {
    contentDir: resolve(contentDir),
    outDir: resolve(process.env.BIAS_OUT_DIR || './dist'),
    deployTarget,
  }
}
