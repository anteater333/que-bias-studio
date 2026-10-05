#!/usr/bin/env node
import { build } from './build.js'
import { getConfig } from './config.js'
import { deploy } from './deploy.js'
import { checkRemoteBeforeDeploy, pull } from './pull.js'
import { startStudio } from './studio/server.js'
import { validateAll } from './validate.js'

const [command, ...flags] = process.argv.slice(2)
const dryRun = flags.includes('--dry-run')
const force = flags.includes('--force')

const USAGE = `사용법:
  yarn studio                 로컬 편집 페이지 열기 (카드 미리보기 + meta.json 편집)
  yarn validate               카드 원본 검증만 수행
  yarn build                  검증 + 해시 파일명 복사 + manifest.json 생성 (dist/)
  yarn deploy                 build 후 서버로 업로드 (서버에만 있는 카드가 있으면 멈춤)
  yarn deploy --dry-run       업로드 대상만 확인 (실제 전송 없음)
  yarn deploy --force         서버에만 있는 카드가 빠지더라도 배포
  yarn pull                   서버에 배포된 카드를 원본 폴더로 받기 (로컬에 없는 카드만)
  yarn pull --dry-run         받을 대상만 확인
  yarn pull --force           로컬과 다른 카드도 서버 기준으로 덮어쓰기`

try {
  switch (command) {
    case 'studio': {
      startStudio(getConfig())
      break
    }
    case 'validate': {
      const { contentDir } = getConfig()
      if (!validateAll(contentDir).ok) process.exit(1)
      break
    }
    case 'build': {
      build(getConfig())
      break
    }
    case 'deploy': {
      const config = getConfig({ requireTarget: true })
      checkRemoteBeforeDeploy({ ...config, force })
      build(config)
      deploy({ ...config, dryRun })
      break
    }
    case 'pull': {
      pull({ ...getConfig({ requireTarget: true }), dryRun, force })
      break
    }
    default:
      console.log(USAGE)
      process.exit(command ? 1 : 0)
  }
} catch (e) {
  console.error(`\n오류: ${e.message}`)
  process.exit(1)
}
