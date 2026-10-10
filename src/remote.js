import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/** rsync 의 비동기 버전 (quiet 고정). 스튜디오 서버처럼 이벤트 루프를 막으면 안 되는 곳에서 쓴다. */
function rsyncAsync(args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn('rsync', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (text) => (stderr += text))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`서버 응답이 ${timeoutMs / 1000}초 안에 오지 않았어요.`))
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(e.code === 'ENOENT' ? 'rsync 가 설치되어 있지 않아요.' : `rsync 실행 실패: ${e.message}`))
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ status, stderr })
    })
  })
}

const manifestArgs = (deployTarget, dir) => ['-az', `${remoteDir(deployTarget)}manifest.json`, `${dir}/`]

/** 서버의 manifest.json 을 받아온다. 아직 한 번도 배포하지 않았으면 null. */
export function fetchRemoteManifest(deployTarget) {
  const dir = makeTempDir()
  return readFetchedManifest(dir, rsync(manifestArgs(deployTarget, dir), { quiet: true }))
}

/** fetchRemoteManifest 의 비동기 버전 */
export async function fetchRemoteManifestAsync(deployTarget, { timeoutMs = 15000 } = {}) {
  const dir = makeTempDir()
  return readFetchedManifest(dir, await rsyncAsync(manifestArgs(deployTarget, dir), { timeoutMs }))
}

function readFetchedManifest(dir, { status, stderr }) {
  if (status === 23 && /No such file/i.test(stderr)) return null
  if (status !== 0) throw new Error(`서버에서 manifest.json 을 받지 못했어요 (rsync 종료 코드 ${status})\n${stderr.trim()}`)

  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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
