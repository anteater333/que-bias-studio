import { createEditor, sanitizeHtml } from './editor.js'

// que-remastered BiasCard 와 같은 값 (BIAS_CARD_SIZE / BIAS_CARD_BLEED)
const CARD_SIZE = 160
const CARD_BLEED = 16

const $ = (id) => document.getElementById(id)

const state = {
  slug: null,
  card: null, // 서버에서 받은 카드 정보
  savedSnapshot: null, // 마지막으로 저장/로드한 meta (dirty 비교용)
}

// ---------- API ----------

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json()
  if (!res.ok) throw Object.assign(new Error(body.errors?.join('\n') ?? body.error), { body })
  return body
}

const fileUrl = (key) => {
  const file = state.card.files[key]
  return file.version ? `/api/cards/${state.slug}/files/${key}?v=${file.version}` : null
}

// ---------- 카드 목록 ----------

async function loadCardList() {
  const { contentDir, cards } = await api('/api/cards')
  $('content-dir').textContent = contentDir
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
  if (cards.length === 0) $('empty').textContent = '카드 폴더가 없어요. 카드 폴더 안에 하위 폴더를 만들어주세요.'
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

// ---------- 미리보기 ----------

/** 이미지를 넣되, 파일이 깨져서 못 읽으면 안내 문구로 바꾼다. */
function imageInto(container, src, missingText) {
  container.classList.remove('missing')
  if (!src) {
    container.classList.add('missing')
    container.textContent = missingText
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
    container.textContent = `파일을 읽을 수 없어요: ${missingText.split(' ')[0]}`
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
    // Que 와 같은 규칙: 포커스일 때 motion, 없으면 still 유지
    const motion = isLead && fileUrl('motion')
    imageInto(imageLayer, motion || fileUrl('still'), `${motion ? 'image-motion.webp' : 'image-still.webp'} 없음`)
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
  imageInto(hero, state.card && fileUrl('detail'), 'image-detail.webp 없음')

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

function renderIssues(saveErrors = []) {
  const { errors, warnings } = state.card
  const items = [
    ...saveErrors.map((m) => ['error', `저장 실패: ${m}`]),
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
