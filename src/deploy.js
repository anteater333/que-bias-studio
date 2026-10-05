import { remoteDir, rsync } from './remote.js'

/**
 * 해시 파일을 먼저, manifest.json 을 마지막에 올린다.
 * manifest 가 아직 올라오지 않은 파일을 가리키는 순간이 생기지 않도록 하기 위함.
 * --delete 는 일부러 쓰지 않는다 (옛 manifest 를 캐시한 사용자가 깨진 이미지를 보지 않도록).
 */
export function deploy({ outDir, deployTarget, dryRun }) {
  const base = ['-avz', ...(dryRun ? ['--dry-run'] : [])]
  const src = remoteDir(outDir)

  console.log(`\n[1/2] 카드 파일 업로드${dryRun ? ' (dry-run)' : ''}`)
  rsync([...base, '--exclude', 'manifest.json', src, deployTarget])

  console.log(`\n[2/2] manifest.json 업로드${dryRun ? ' (dry-run)' : ''}`)
  rsync([...base, `${src}manifest.json`, deployTarget])

  console.log(dryRun ? '\ndry-run 완료 (실제로는 아무것도 올라가지 않았어요)' : '\n배포 완료')
}
