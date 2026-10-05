import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MANIFEST_VERSION } from './config.js'

/** rsync 실행. quiet 이면 출력을 숨기고 { status, stderr } 를 돌려준다 (실패해도 throw 하지 않음). */
export function rsync(args, { quiet = false } = {}) {
  const r = spawnSync('rsync', args, { stdio: quiet ? ['ignore', 'ignore', 'pipe'] : 'inherit', encoding: 'utf8' })
  if (r.error) {
    throw new Error(
      r.error.code === 'ENOENT' ? 'rsync 가 설치되어 있지 않아요.' : `rsync 실행 실패: ${r.error.message}`,
    )
  }
  if (quiet) return { status: r.status, stderr: r.stderr ?? '' }
  if (r.status !== 0) throw new Error(`rsync 가 종료 코드 ${r.status} 로 실패했어요.`)
}

/** user@host:/path 와 로컬 경로 모두 "디렉터리/" 형태로 맞춘다 */
export const remoteDir = (deployTarget) => (deployTarget.endsWith('/') ? deployTarget : `${deployTarget}/`)

export const makeTempDir = () => mkdtempSync(join(tmpdir(), 'que-bias-'))

/** 서버의 manifest.json 을 받아온다. 아직 한 번도 배포하지 않았으면 null. */
export function fetchRemoteManifest(deployTarget) {
  const dir = makeTempDir()
  const { status, stderr } = rsync(['-az', `${remoteDir(deployTarget)}manifest.json`, `${dir}/`], { quiet: true })
  if (status === 23 && /No such file/i.test(stderr)) return null
  if (status !== 0) throw new Error(`서버에서 manifest.json 을 받지 못했어요 (rsync 종료 코드 ${status})\n${stderr.trim()}`)

  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`서버 manifest 버전(${manifest.version})이 이 도구의 버전(${MANIFEST_VERSION})과 달라요.`)
  }
  return manifest
}

/** 서버 기준 상대 경로 목록(nell/title.4b111f47.svg ...)을 임시 폴더로 받아서 그 경로를 돌려준다. */
export function fetchRemoteFiles(deployTarget, paths) {
  const dir = makeTempDir()
  if (paths.length === 0) return dir
  const list = join(dir, '.files-from')
  writeFileSync(list, paths.join('\n') + '\n')
  rsync(['-az', `--files-from=${list}`, remoteDir(deployTarget), `${dir}/`])
  return dir
}
