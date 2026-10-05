// description 용 리치 텍스트 에디터. Quill 2 를 CDN 에서 불러와 쓴다 (스튜디오를 열 때 인터넷 연결 필요).
// Quill 에 허용 서식을 제한해 두고, 저장/미리보기 시에도 sanitizeHtml 로 한 번 더 걸러서
// meta.json 에는 항상 단순한 HTML 만 들어가게 한다.

const QUILL_URL = 'https://cdn.jsdelivr.net/npm/quill@2.0.3/+esm'

// 허용 태그 (key: 입력 태그, value: 출력 태그)
const TAG_MAP = {
  P: 'p',
  DIV: 'p',
  BR: 'br',
  STRONG: 'strong',
  B: 'strong',
  EM: 'em',
  I: 'em',
  U: 'u',
  S: 's',
  STRIKE: 's',
  DEL: 's',
  A: 'a',
  UL: 'ul',
  OL: 'ol',
  LI: 'li',
}
// 내용까지 통째로 버리는 태그
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'META', 'LINK', 'TITLE', 'TEMPLATE'])
const BLOCK_TAGS = new Set(['p', 'ul', 'ol'])
const SAFE_HREF = /^(https?:|mailto:)/i

function cleanNode(node, doc) {
  // Quill 이 공백을 &nbsp; 로 내보내는 경우가 있어 일반 공백으로 되돌린다
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent.replace(/\u00a0/g, ' '))
  if (node.nodeType !== Node.ELEMENT_NODE || DROP_TAGS.has(node.tagName)) return null

  const children = [...node.childNodes].map((c) => cleanNode(c, doc)).filter(Boolean)
  const tag = TAG_MAP[node.tagName]
  // 모르는 태그(span, font, h1 ...)는 껍데기만 벗기고 내용은 살린다
  if (!tag) {
    const frag = doc.createDocumentFragment()
    frag.append(...children)
    return frag
  }

  const el = doc.createElement(tag)
  if (tag === 'ul' || tag === 'ol') {
    // 목록 안의 들여쓰기 공백은 의미가 없으니 버린다
    el.append(...children.filter((c) => c.nodeType !== Node.TEXT_NODE || c.textContent.trim()))
    return el
  }
  if (tag === 'a') {
    const href = node.getAttribute('href')?.trim()
    if (!href || !SAFE_HREF.test(href)) {
      const frag = doc.createDocumentFragment()
      frag.append(...children)
      return frag
    }
    el.setAttribute('href', href)
  }
  el.append(...children)
  return el
}

/** 허용 태그만 남기고, 최상위의 맨 텍스트/인라인 요소는 <p> 로 감싼다. */
export function sanitizeHtml(html) {
  const doc = document.implementation.createHTMLDocument('')
  const src = new DOMParser().parseFromString(html, 'text/html').body
  const out = doc.createElement('div')
  for (const child of src.childNodes) {
    const cleaned = cleanNode(child, doc)
    if (cleaned) out.append(cleaned)
  }

  // 최상위 정리: 인라인 조각은 <p> 로 묶고, p 안의 p 같은 중첩 블록은 풀어준다
  const result = doc.createElement('div')
  let inline = null
  for (const node of [...out.childNodes]) {
    const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName.toLowerCase())
    if (isBlock) {
      inline = null
      result.append(node)
    } else if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim() && !inline) {
      // 블록 사이의 줄바꿈 공백은 버린다
    } else {
      if (!inline) {
        inline = doc.createElement('p')
        result.append(inline)
      }
      inline.append(node)
    }
  }
  for (const p of result.querySelectorAll('p p')) p.replaceWith(...p.childNodes)
  // 내용이 없는 문단(<p></p>, <p><br></p>) 정리
  for (const p of result.querySelectorAll('p')) {
    if (!p.textContent.trim() && !p.querySelector('br')) p.remove()
  }
  while (result.lastElementChild?.matches('p') && !result.lastElementChild.textContent.trim()) {
    result.lastElementChild.remove()
  }

  return result.textContent.trim() ? result.innerHTML : ''
}

/**
 * Quill 에디터와 HTML 소스 textarea 를 묶어서 하나의 에디터로 다룬다.
 * onChange 는 내용이 바뀔 때마다 호출된다 (미리보기/dirty 표시용).
 */
export async function createEditor({ container, source, sourceToggle, onChange }) {
  const { default: Quill } = await import(QUILL_URL)

  container.replaceChildren()
  const quill = new Quill(container, {
    theme: 'snow',
    placeholder: '아티스트 소개를 적어주세요',
    // 여기 없는 서식은 붙여넣기 해도 버려진다
    formats: ['bold', 'italic', 'underline', 'strike', 'link', 'list'],
    modules: {
      toolbar: [['bold', 'italic', 'underline', 'strike'], [{ list: 'ordered' }, { list: 'bullet' }], ['link'], ['clean']],
    },
  })

  let sourceMode = false
  const getRawHtml = () => (sourceMode ? source.value : quill.getSemanticHTML())
  const setQuillHtml = (html) => quill.setContents(quill.clipboard.convert({ html }), 'silent')

  quill.on('text-change', () => onChange())
  source.addEventListener('input', () => onChange())

  sourceToggle.addEventListener('click', () => {
    if (sourceMode) setQuillHtml(sanitizeHtml(source.value))
    else source.value = sanitizeHtml(quill.getSemanticHTML()).replace(/<\/(p|ul|ol|li)>/g, '</$1>\n').trim()
    sourceMode = !sourceMode
    container.parentElement.classList.toggle('source-mode', sourceMode)
    source.hidden = !sourceMode
    sourceToggle.setAttribute('aria-pressed', String(sourceMode))
    if (sourceMode) source.focus()
    else quill.focus()
    onChange()
  })

  return {
    /** 저장용 HTML (sanitize 완료) */
    getHtml: () => sanitizeHtml(getRawHtml()),
    setHtml(html) {
      const clean = sanitizeHtml(html ?? '')
      setQuillHtml(clean)
      source.value = clean
    },
  }
}
