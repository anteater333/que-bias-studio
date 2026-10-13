#!/usr/bin/env node
import { build, buildOne } from './build.js'
import { getConfig, SLUG_PATTERN } from './config.js'
import { deploy } from './deploy.js'
import { checkRemoteBeforeDeploy, pull } from './pull.js'
import { fetchRemoteManifest } from './remote.js'
import { startStudio } from './studio/server.js'
import { validateAll } from './validate.js'

const [command, ...flags] = process.argv.slice(2)
const dryRun = flags.includes('--dry-run')
const force = flags.includes('--force')
// --card <slug> 또는 --card=<slug>
const cardIndex = flags.findIndex((f) => f === '--card' || f.startsWith('--card='))
const card = cardIndex < 0 ? null : flags[cardIndex].startsWith('--card=') ? flags[cardIndex].slice(7) : flags[cardIndex + 1]

const USAGE = `사용법:
  yarn studio                 로컬 편집 페이지 열기 (카드 미리보기 + meta.json 편집)
  yarn validate               카드 원본 검증만 수행
  yarn build                  검증 + 해시 파일명 복사 + manifest.json 생성 (dist/)
  yarn deploy                 build 후 서버로 업로드 (서버에만 있는 카드가 있으면 멈춤)
  yarn deploy --dry-run       업로드 대상만 확인 (실제 전송 없음)
  yarn deploy --force         서버에만 있는 카드가 빠지더라도 배포
  yarn deploy --card <slug>   카드 하나만 배포 (서버의 다른 카드는 그대로 둠)
  yarn pull                   서버에 배포된 카드를 원본 폴더로 받기 (로컬에 없는 카드만)
  yarn pull --dry-run         받을 대상만 확인
  yarn pull --force           로컬과 다른 카드도 서버 기준으로 덮어쓰기
  yarn pull --card <slug>     카드 하나만 받기 (--force 와 같이 쓸 수 있음)`

try {
  if (cardIndex >= 0 && !SLUG_PATTERN.test(card ?? '')) throw new Error(`--card 에 카드 slug 를 적어주세요 (받은 값: ${card})`)
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
      if (card) {
        // 서버 manifest 에서 이 카드만 바꿔 끼우므로 다른 카드가 빠질 일이 없다 (--force 불필요)
        console.log(`서버에서 manifest.json 확인 중... (${config.deployTarget})`)
        const remoteCards = fetchRemoteManifest(config.deployTarget)?.cards ?? []
        buildOne({ ...config, slug: card, remoteCards })
      } else {
        checkRemoteBeforeDeploy({ ...config, force })
        build(config)
      }
      deploy({ ...config, dryRun })
      break
    }
    case 'pull': {
      pull({ ...getConfig({ requireTarget: true }), dryRun, force, card })
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
