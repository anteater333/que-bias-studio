import { createEditor, sanitizeHtml } from './editor.js'

// que-remastered BiasCard 와 같은 값 (BIAS_CARD_SIZE / BIAS_CARD_BLEED)
const CARD_SIZE = 160
const CARD_BLEED = 16

const $ = (id) => document.getElementById(id)

const state = {
  slug: null,
  card: null, // 서버에서 받은 카드 정보
  savedSnapshot: null, // 마지막으로 저장/로드한 meta (dirty 비교용)
  deployTarget: null, // BIAS_DEPLOY_TARGET (없으면 배포/받기 불가)
}

// ---------- API ----------

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json()
  if (!res.ok) throw Object.assign(new Error(body.errors?.join('\n') ?? body.error), { body })
  return body
}

const fileName = (key) => state.card.files[key].name

const fileUrl = (key) => {
  const file = state.card.files[key]
  return file.version ? `/api/cards/${state.slug}/files/${key}?v=${file.version}` : null
}

// ---------- 카드 목록 ----------

async function loadCardList() {
  const { contentDir, deployTarget, cards } = await api('/api/cards')
  $('content-dir').textContent = contentDir
  state.deployTarget = deployTarget
  const list = $('card-list')
  list.replaceChildren(
    ...cards.map(({ slug, errors, warnings }) => {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = `#${slug}`
      a.textContent = slug
      a.className = errors ? 'has-errors' : warnings ? 'has-warnings' : 'ok'
      a.title = errors ? `에러 ${errors}개` : warnings ? `경고 ${warnings}개` : '문제 없음'
      if (slug === state.slug) a.setAttribute('aria-current', 'page')
      li.append(a)
      return li
    }),
  )
  if (cards.length === 0) $('empty').textContent = '카드가 아직 없어요. 왼쪽 위에서 새 카드를 만들어주세요.'
  return cards
}

// ---------- 폼 <-> meta ----------

const form = $('meta-form')
const editor = await createEditor({
  container: $('rte'),
  source: $('rte-source'),
  sourceToggle: $('toggle-source'),
  onChange: () => onFormChange(),
}).catch((e) => {
  // CDN 을 못 불러오면(오프라인 등) HTML 을 직접 쓰는 textarea 로 대신한다
  console.error(e)
  $('rte').textContent = '에디터를 불러오지 못했어요 (인터넷 연결 확인). 아래에 HTML 을 직접 입력할 수 있어요.'
  $('rte').className = 'rte-error'
  $('toggle-source').hidden = true
  $('rte-source').hidden = false
  return {
    getHtml: () => sanitizeHtml($('rte-source').value),
    setHtml: (html) => ($('rte-source').value = sanitizeHtml(html ?? '')),
  }
})

/** 추천 트랙/영상 목록에 { title, url } 한 줄을 추가한다. */
function addLinkRow(listId, item = {}) {
  const list = $(listId)
  const row = $('link-item-template').content.firstElementChild.cloneNode(true)
  row.querySelector('[name=title]').value = item.title ?? ''
  row.querySelector('[name=url]').value = item.url ?? ''
  row.querySelector('[name=url]').placeholder = list.dataset.urlPlaceholder
  list.append(row)
  return row
}

const readLinkRows = (listId) =>
  [...$(listId).children].map((row) => {
    const title = row.querySelector('[name=title]').value.trim()
    const url = row.querySelector('[name=url]').value.trim()
    return url ? { title, url } : { title }
  })

function fillForm(meta) {
  form.nameKo.value = meta?.nameKo ?? ''
  form.nameEn.value = meta?.nameEn ?? ''
  editor.setHtml(meta?.description ?? '')
  $('tracks').replaceChildren()
  for (const track of meta?.recommendedTracks ?? []) addLinkRow('tracks', track)
  $('videos').replaceChildren()
  for (const video of meta?.recommendedVideos ?? []) addLinkRow('videos', video)
  state.savedSnapshot = JSON.stringify(collectMeta())
  onFormChange()
}

/** 폼 값을 meta.json 형태로. 폼에 없는 키(앞으로 추가될 필드 등)는 원래 값을 그대로 둔다. */
function collectMeta() {
  const meta = {
    ...state.card?.meta,
    nameKo: form.nameKo.value.trim(),
    nameEn: form.nameEn.value.trim(),
    description: editor.getHtml(),
    recommendedTracks: readLinkRows('tracks'),
  }
  // 선택 필드라서, 원래 없던 카드에 빈 배열을 새로 써넣지는 않는다
  const videos = readLinkRows('videos')
  if (videos.length || state.card?.meta?.recommendedVideos) meta.recommendedVideos = videos
  return meta
}

const isDirty = () => state.card && JSON.stringify(collectMeta()) !== state.savedSnapshot

function onFormChange() {
  renderDetail(collectMeta())
  const dirty = isDirty()
  $('save-status').textContent = dirty ? '저장하지 않은 변경사항이 있어요' : ''
  $('save-status').classList.toggle('dirty', dirty)
}

form.addEventListener('input', onFormChange)

form.addEventListener('click', (e) => {
  const add = e.target.closest('button[data-add]')
  if (add) {
    addLinkRow(add.dataset.add).querySelector('input').focus()
    return onFormChange()
  }
  const button = e.target.closest('.link-item button[data-action]')
  if (!button) return
  const row = button.closest('li')
  const { action } = button.dataset
  if (action === 'remove') row.remove()
  if (action === 'up' && row.previousElementSibling) row.previousElementSibling.before(row)
  if (action === 'down' && row.nextElementSibling) row.nextElementSibling.after(row)
  onFormChange()
})

// ---------- 저장 ----------

async function save() {
  if (!state.card) return
  $('save').disabled = true
  try {
    const meta = collectMeta()
    state.card = await api(`/api/cards/${state.slug}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    })
    // 정리된 HTML 이 에디터에도 반영되도록 다시 채운다
    fillForm(state.card.meta)
    renderIssues()
    $('external-notice').hidden = true
    $('save-status').textContent = '저장했어요'
    loadCardList()
  } catch (e) {
    renderIssues(e.body?.errors ?? [e.message])
  } finally {
    $('save').disabled = false
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  save()
})

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    save()
  }
})

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) e.preventDefault()
})

// ---------- 파일 업로드 ----------

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`

function renderFiles() {
  const list = $('file-list')
  list.replaceChildren(
    ...Object.entries(state.card.files).map(([key, file]) => {
      const row = $('file-item-template').content.firstElementChild.cloneNode(true)
      row.dataset.key = key
      row.querySelector('.file-name code').textContent = file.name
      const status = row.querySelector('.file-status')
      status.textContent = file.size !== null ? formatSize(file.size) : file.optional ? '없음 (선택)' : '없음'
      status.classList.toggle('missing-required', file.size === null && !file.optional)
      row.querySelector('.file-action').textContent = file.size !== null ? '바꾸기' : '올리기'
      row.querySelector('input').accept = file.name.slice(file.name.lastIndexOf('.'))
      return row
    }),
  )
}

async function upload(key, file) {
  const { name } = state.card.files[key]
  const ext = name.slice(name.lastIndexOf('.'))
  if (!file.name.toLowerCase().endsWith(ext)) return renderIssues([`${name} 자리에는 ${ext} 파일만 올릴 수 있어요`])
  const slug = state.slug
  const row = $('file-list').querySelector(`[data-key="${key}"]`)
  row?.classList.add('uploading')
  try {
    const card = await api(`/api/cards/${slug}/files/${key}`, { method: 'PUT', body: file })
    if (slug !== state.slug) return
    // 업로드는 meta 를 건드리지 않으니 작성 중인 폼은 그대로 둔다
    state.card = { ...card, meta: state.card.meta }
    renderCards()
    renderFiles()
    renderIssues()
    loadCardList()
  } catch (e) {
    if (slug === state.slug) renderIssues(e.body?.errors ?? [e.message], '업로드 실패')
  } finally {
    row?.classList.remove('uploading')
  }
}

$('file-list').addEventListener('change', (e) => {
  const file = e.target.files?.[0]
  if (file) upload(e.target.closest('li').dataset.key, file)
  e.target.value = ''
})

$('file-list').addEventListener('dragover', (e) => {
  const row = e.target.closest('.file-item')
  if (!row) return
  e.preventDefault()
  row.classList.add('dragover')
})

$('file-list').addEventListener('dragleave', (e) => {
  const row = e.target.closest('.file-item')
  if (row && !row.contains(e.relatedTarget)) row.classList.remove('dragover')
})

$('file-list').addEventListener('drop', (e) => {
  const row = e.target.closest('.file-item')
  if (!row) return
  e.preventDefault()
  row.classList.remove('dragover')
  const file = e.dataTransfer.files[0]
  if (file) upload(row.dataset.key, file)
})

// 줄 밖에 떨어뜨렸을 때 브라우저가 파일을 열어버리지 않도록
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// ---------- 새 카드 ----------

$('new-card-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = e.target.slug
  const slug = input.value.trim()
  try {
    await api('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    })
    $('new-card-error').hidden = true
    input.value = ''
    await loadCardList()
    location.hash = slug
  } catch (err) {
    $('new-card-error').textContent = err.message
    $('new-card-error').hidden = false
  }
})

// ---------- 배포 / 받기 ----------

const COMMANDS = {
  deploy: {
    title: '배포',
    desc: '로컬 카드 전체를 검증하고 빌드해서 서버로 올려요.',
    force: '서버에만 있는 카드가 빠져도 배포 (--force)',
  },
  pull: {
    title: '서버에서 받기',
    desc: '서버에 배포된 카드를 받아요. 기본은 로컬에 없는 카드만 받고, 로컬과 다른 카드는 건너뛰어요.',
    force: '로컬과 다른 카드도 서버 기준으로 덮어쓰기 (--force)',
  },
}

const commandForm = $('command-form')
let currentCommand = null
let commandRunning = false

function openCommand(name) {
  const info = COMMANDS[name]
  currentCommand = name
  $('command-title').textContent = info.title
  $('command-desc').textContent = info.desc
  $('command-force-label').textContent = info.force
  $('command-target').textContent = state.deployTarget ?? '(설정 안 됨)'
  commandForm.reset()
  $('command-log').hidden = true
  $('command-log').replaceChildren()
  $('command-status').textContent = ''
  $('command-status').className = 'command-status'
  $('command-run').disabled = !state.deployTarget
  // 배포는 디스크에 저장된 파일 기준이라 작성 중인 내용은 안 들어간다
  const warning = !state.deployTarget
    ? 'BIAS_DEPLOY_TARGET 이 설정되지 않았어요. .env.local 을 확인하고 스튜디오를 다시 켜주세요.'
    : name === 'deploy' && isDirty()
      ? 'meta.json 에 저장하지 않은 변경사항이 있어요. 저장한 내용만 배포돼요.'
      : null
  $('command-warning').textContent = warning ?? ''
  $('command-warning').hidden = !warning
  $('command-dialog').showModal()
}

function appendLog(text, stream) {
  const log = $('command-log')
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24
  const span = document.createElement('span')
  if (stream === 'err') span.className = 'err'
  span.textContent = text
  log.append(span)
  if (atBottom) log.scrollTop = log.scrollHeight
}

function setCommandRunning(running) {
  commandRunning = running
  $('command-run').disabled = running
  $('command-close').disabled = running
  for (const input of commandForm.querySelectorAll('input')) input.disabled = running
  for (const button of document.querySelectorAll('[data-command]')) button.disabled = running
}

async function runCommand() {
  const name = currentCommand
  const options = { dryRun: commandForm.dryRun.checked, force: commandForm.force.checked }
  $('command-log').hidden = false
  $('command-log').replaceChildren()
  $('command-status').className = 'command-status'
  $('command-status').textContent = '실행 중...'
  setCommandRunning(true)
  let exit = null
  try {
    const res = await fetch(`/api/commands/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.errors?.join('\n') ?? body.error ?? `HTTP ${res.status}`)
    }
    // 한 줄에 JSON 하나씩 온다. 청크가 줄 중간에서 잘릴 수 있어서 남은 조각은 다음 청크와 합친다
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines.filter(Boolean)) {
        const msg = JSON.parse(line)
        if ('exit' in msg) exit = msg.exit
        else appendLog(msg.text, msg.stream)
      }
    }
    if (exit === null) throw new Error('스튜디오와 연결이 끊겼어요. 터미널에서 결과를 확인해주세요.')
  } catch (e) {
    appendLog(`\n${e.message}\n`, 'err')
  } finally {
    setCommandRunning(false)
  }
  const ok = exit === 0
  $('command-status').textContent = ok ? (options.dryRun ? '미리보기 완료' : '완료') : '실패'
  $('command-status').classList.add(ok ? 'ok' : 'failed')
  // 받은 카드는 watcher 가 알려주지만, 새 폴더가 생겼을 수 있으니 목록은 한 번 더 갱신
  if (name === 'pull') loadCardList()
}

for (const button of document.querySelectorAll('[data-command]')) {
  button.addEventListener('click', () => openCommand(button.dataset.command))
}
$('command-run').addEventListener('click', runCommand)
// 실행 중에는 Esc 로 닫히지 않게 (닫아도 명령은 계속 돌지만 결과를 놓친다)
$('command-dialog').addEventListener('cancel', (e) => {
  if (commandRunning) e.preventDefault()
})

// ---------- 카드 삭제 ----------

const deleteForm = $('delete-form')
let remoteCheck = 0 // 늦게 도착한 서버 확인 결과가 다른 카드 모달에 덮어쓰지 않도록

function setDeleteRemote(text, level = 'warn') {
  $('delete-remote').textContent = text
  $('delete-remote').className = `command-warning ${level}`
}

async function openDelete() {
  const slug = state.slug
  const check = ++remoteCheck
  deleteForm.reset()
  $('delete-slug').textContent = slug
  $('delete-run').disabled = true
  setDeleteRemote('서버에 배포된 카드인지 확인하는 중...', 'muted')
  $('delete-dialog').showModal()
  deleteForm.confirm.focus()

  const { deployed, error } = await api(`/api/cards/${encodeURIComponent(slug)}/remote`).catch((e) => ({
    deployed: null,
    error: e.message,
  }))
  if (check !== remoteCheck) return
  if (deployed) {
    setDeleteRemote(
      '서버에 배포된 카드예요. 여기서 지워도 서비스에는 그대로 남아요. ' +
        '서비스에서도 빼려면 삭제 후 배포할 때 --force 를 체크해야 하고, 그 전에 "서버에서 받기"를 하면 이 카드가 다시 내려와요.',
    )
  } else if (deployed === false) {
    setDeleteRemote('서버에 배포된 적 없는 카드예요. 지우면 어디에도 남지 않아요.', 'error')
  } else {
    setDeleteRemote(`서버 상태를 확인하지 못했어요 (${error}). 배포된 카드라면 서비스에는 남아 있어요.`)
  }
}

async function deleteCard() {
  const slug = state.slug
  $('delete-run').disabled = true
  try {
    await api(`/api/cards/${encodeURIComponent(slug)}`, { method: 'DELETE' })
  } catch (e) {
    setDeleteRemote(`삭제 실패: ${e.message}`, 'error')
    $('delete-run').disabled = false
    return
  }
  $('delete-dialog').close()
  // 지운 카드의 작성 중인 내용 때문에 이동 확인창이 뜨지 않도록 상태를 먼저 비운다
  state.slug = null
  state.card = null
  const cards = await loadCardList()
  const next = cards[0]?.slug
  if (next) {
    location.hash = next
  } else {
    history.replaceState(null, '', location.pathname)
    lastHash = ''
    $('workspace').hidden = true
    $('empty').hidden = false
  }
}

$('delete-card').addEventListener('click', openDelete)
deleteForm.confirm.addEventListener('input', (e) => {
  $('delete-run').disabled = e.target.value.trim() !== state.slug
})
$('delete-run').addEventListener('click', deleteCard)
// 입력칸에서 Enter 를 누르면 폼의 첫 submit 버튼(취소)이 눌린 것으로 처리돼서 직접 막는다.
// 이름을 다 입력한 상태면 삭제
deleteForm.confirm.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return
  e.preventDefault()
  if (!$('delete-run').disabled) deleteCard()
})

// ---------- 미리보기 ----------

/** 이미지를 넣되, 파일이 없거나 깨져서 못 읽으면 안내 문구로 바꾼다. */
function imageInto(container, src, name) {
  container.classList.remove('missing')
  if (!src) {
    container.classList.add('missing')
    container.textContent = `${name} 없음`
    return
  }
  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  container.replaceChildren(img)
  // 캐시된 깨진 이미지는 error 이벤트를 놓칠 수 있어서 decode 결과로 판단한다
  img.decode().catch(() => {
    if (!img.isConnected) return
    container.classList.add('missing')
    container.textContent = `파일을 읽을 수 없어요: ${name}`
  })
}

/** 파일로 저장된 svg 를 카드 레이어로 인라인. currentColor 가 페이지 글자색을 따라가도록. */
function svgLayer(markup) {
  const layer = document.createElement('div')
  layer.className = 'overlay-layer'
  if (!markup) return layer
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  if (svg.nodeName !== 'svg') return layer
  // 로컬 파일이지만 혹시 모를 스크립트는 제거
  svg.querySelectorAll('script, foreignObject').forEach((el) => el.remove())
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
  }
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('aria-hidden', 'true')
  layer.append(document.importNode(svg, true))
  return layer
}

function renderCards() {
  const { svg } = state.card
  for (const el of document.querySelectorAll('.bias-card')) {
    const isLead = el.dataset.lead === 'true'
    const imageLayer = document.createElement('div')
    imageLayer.className = 'image-layer'
    // Que 와 같은 규칙: 포커스일 때 motion, 없으면 still 로 대신 그린다.
    // 다만 이 프로젝트에선 motion 이 필수라서, 대신 그린 경우엔 빠졌다는 걸 따로 알려준다
    const motion = fileUrl('motion')
    const still = fileUrl('still')
    const fallback = isLead && !motion && still
    if (isLead && !fallback) imageInto(imageLayer, motion, fileName('motion'))
    else imageInto(imageLayer, still, fileName('still'))
    el.parentElement.querySelector('.card-note').textContent = fallback
      ? `${fileName('motion')} 없음 (still 로 표시 중)`
      : ''
    const bleed = document.createElement('div')
    bleed.className = 'bleed-guide'
    el.replaceChildren(imageLayer, svgLayer(svg.deco), svgLayer(svg.title), bleed)
  }
}

/** 유튜브 링크면 썸네일 주소를 돌려준다 (미리보기용). */
function youtubeThumbnail(url) {
  try {
    const u = new URL(url)
    const id = u.hostname.endsWith('youtu.be')
      ? u.pathname.slice(1)
      : u.hostname.endsWith('youtube.com')
        ? u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1]
        : null
    return id && /^[\w-]{6,}$/.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null
  } catch {
    return null
  }
}

function renderDetail(meta) {
  const detail = $('detail')
  const hero = document.createElement('div')
  hero.className = 'detail-hero'
  if (state.card) imageInto(hero, fileUrl('detail'), fileName('detail'))

  const body = document.createElement('div')
  body.className = 'detail-body'

  const name = document.createElement('h1')
  name.textContent = meta.nameKo || '한글 이름'
  name.classList.toggle('placeholder', !meta.nameKo)
  const nameEn = document.createElement('p')
  nameEn.className = 'detail-name-en'
  nameEn.textContent = meta.nameEn || 'English name'
  nameEn.classList.toggle('placeholder', !meta.nameEn)

  const description = document.createElement('div')
  description.className = 'detail-description'
  // sanitize 를 거친 HTML 만 넣는다
  description.innerHTML = sanitizeHtml(meta.description ?? '') || '<p class="placeholder">설명</p>'

  const tracksTitle = document.createElement('h2')
  tracksTitle.textContent = '추천 트랙'
  const tracks = document.createElement('ul')
  tracks.className = 'detail-tracks'
  for (const track of meta.recommendedTracks ?? []) {
    const li = document.createElement('li')
    if (track.url) {
      const a = document.createElement('a')
      a.href = track.url
      a.target = '_blank'
      a.rel = 'noreferrer'
      a.textContent = track.title || '(제목 없음)'
      li.append(a)
    } else {
      li.textContent = track.title || '(제목 없음)'
    }
    tracks.append(li)
  }

  const videosTitle = document.createElement('h2')
  videosTitle.textContent = '추천 영상'
  const videos = document.createElement('ul')
  videos.className = 'detail-videos'
  for (const video of meta.recommendedVideos ?? []) {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.href = video.url ?? ''
    a.target = '_blank'
    a.rel = 'noreferrer'
    const thumb = youtubeThumbnail(video.url)
    if (thumb) {
      const img = document.createElement('img')
      img.src = thumb
      img.alt = ''
      a.append(img)
    }
    a.append(video.title || '(제목 없음)')
    li.append(a)
    videos.append(li)
  }

  body.append(name, nameEn, description)
  if (tracks.children.length) body.append(tracksTitle, tracks)
  if (videos.children.length) body.append(videosTitle, videos)
  detail.replaceChildren(hero, body)
}

function renderIssues(saveErrors = [], prefix = '저장 실패') {
  const { errors, warnings } = state.card
  const items = [
    ...saveErrors.map((m) => ['error', `${prefix}: ${m}`]),
    ...errors.map((m) => ['error', m]),
    ...warnings.map((m) => ['warn', m]),
  ]
  const section = $('issues')
  section.hidden = items.length === 0
  const ul = document.createElement('ul')
  for (const [level, message] of items) {
    const li = document.createElement('li')
    li.className = level
    li.textContent = message
    ul.append(li)
  }
  section.replaceChildren(ul)
}

// ---------- 카드 선택 / 변경 감지 ----------

async function openCard(slug) {
  if (!slug) return
  try {
    state.card = await api(`/api/cards/${encodeURIComponent(slug)}`)
  } catch (e) {
    $('empty').textContent = e.message
    $('empty').hidden = false
    $('workspace').hidden = true
    return
  }
  state.slug = slug
  $('empty').hidden = true
  $('workspace').hidden = false
  $('card-slug').textContent = slug
  $('external-notice').hidden = true
  for (const a of $('card-list').querySelectorAll('a')) {
    a.toggleAttribute('aria-current', a.getAttribute('href') === `#${slug}`)
  }
  renderCards()
  renderFiles()
  renderIssues()
  fillForm(state.card.meta)
}

let lastHash = location.hash
window.addEventListener('hashchange', () => {
  if (isDirty() && !window.confirm('저장하지 않은 변경사항이 있어요. 다른 카드로 이동할까요?')) {
    history.replaceState(null, '', lastHash)
    return
  }
  lastHash = location.hash
  openCard(decodeURIComponent(location.hash.slice(1)))
})

/** 디자이너가 파일을 저장하면 미리보기를 갱신한다. 작성 중인 meta 는 덮어쓰지 않는다. */
async function onExternalChange(slug) {
  loadCardList()
  if (!state.slug || (slug && slug !== state.slug)) return
  const card = await api(`/api/cards/${state.slug}`).catch(() => null)
  if (!card) return
  const metaChanged = JSON.stringify(card.meta) !== JSON.stringify(state.card.meta)
  const formMatchesFile = JSON.stringify(collectMeta()) === JSON.stringify({ ...card.meta, ...pickFormKeys(card.meta) })
  state.card = { ...card, meta: isDirty() ? state.card.meta : card.meta }
  renderCards()
  renderFiles()
  renderIssues()
  if (!metaChanged || formMatchesFile) return onFormChange()
  if (isDirty()) $('external-notice').hidden = false
  else fillForm(card.meta)
}

const normalizeLinks = (items = []) =>
  items.map(({ title, url }) =>
    url?.trim() ? { title: title?.trim() ?? '', url: url.trim() } : { title: title?.trim() ?? '' },
  )

// 비교할 때 폼과 같은 정규화를 거치도록
function pickFormKeys(meta) {
  return {
    nameKo: meta?.nameKo?.trim() ?? '',
    nameEn: meta?.nameEn?.trim() ?? '',
    description: sanitizeHtml(meta?.description ?? ''),
    recommendedTracks: normalizeLinks(meta?.recommendedTracks),
    ...(meta?.recommendedVideos && { recommendedVideos: normalizeLinks(meta.recommendedVideos) }),
  }
}

$('reload-meta').addEventListener('click', async () => {
  state.card = await api(`/api/cards/${state.slug}`)
  $('external-notice').hidden = true
  renderCards()
  renderFiles()
  renderIssues()
  fillForm(state.card.meta)
})

$('show-bleed').addEventListener('change', (e) => $('card-stage').classList.toggle('show-bleed', e.target.checked))
$('zoom').addEventListener('change', (e) => $('card-stage').classList.toggle('zoom', e.target.checked))
$('card-stage').classList.add('show-bleed')
document.documentElement.style.setProperty('--card-size', `${CARD_SIZE}px`)
document.documentElement.style.setProperty('--card-bleed', `${CARD_BLEED}px`)

new EventSource('/api/events').addEventListener('message', (e) => onExternalChange(JSON.parse(e.data).slug))

const cards = await loadCardList()
const initial = decodeURIComponent(location.hash.slice(1)) || cards[0]?.slug
if (initial) {
  if (!location.hash) history.replaceState(null, '', `#${initial}`)
  lastHash = location.hash
  openCard(initial)
}
