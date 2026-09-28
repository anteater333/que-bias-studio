import { spawnSync } from 'node:child_process'

function rsync(args) {
  const r = spawnSync('rsync', args, { stdio: 'inherit' })
  if (r.error) {
    throw new Error(
      r.error.code === 'ENOENT' ? 'rsync 가 설치되어 있지 않아요.' : `rsync 실행 실패: ${r.error.message}`,
    )
  }
  if (r.status !== 0) throw new Error(`rsync 가 종료 코드 ${r.status} 로 실패했어요.`)
}

/**
 * 해시 파일을 먼저, manifest.json 을 마지막에 올린다.
 * manifest 가 아직 올라오지 않은 파일을 가리키는 순간이 생기지 않도록 하기 위함.
 * --delete 는 일부러 쓰지 않는다 (옛 manifest 를 캐시한 사용자가 깨진 이미지를 보지 않도록).
 */
export function deploy({ outDir, deployTarget, dryRun }) {
  const base = ['-avz', ...(dryRun ? ['--dry-run'] : [])]
  const src = outDir.endsWith('/') ? outDir : `${outDir}/`

  console.log(`\n[1/2] 카드 파일 업로드${dryRun ? ' (dry-run)' : ''}`)
  rsync([...base, '--exclude', 'manifest.json', src, deployTarget])

  console.log(`\n[2/2] manifest.json 업로드${dryRun ? ' (dry-run)' : ''}`)
  rsync([...base, `${src}manifest.json`, deployTarget])

  console.log(dryRun ? '\ndry-run 완료 (실제로는 아무것도 올라가지 않았어요)' : '\n배포 완료')
}
