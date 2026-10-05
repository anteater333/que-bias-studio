# Que 최애 제작소

Que Bias Studio는 [Que](https://github.com/anteater333/que-remastered) 서비스의 "좋아해요" 기능을 위한 카드 데이터 생성에 필요한 기반 구조를 제공하는 프로젝트입니다.

## 원재료 구조 설명

- `bias-sample` 폴더를 참고.

```
bias/                     # 루트 경로
-- {artist}/              # 각 아티스트마다 폴더로 구분
---- deco.svg             # [선택] 이미지 내 꾸밈 효과를 원할 경우 (거의 안쓸듯)
---- image-detail.webp    # 카드 상세 진입 시 이미지 (가로 비율)
---- image-motion.webp    # 카드 포커스 시 움직이는 이미지
---- image-still.webp     # 카드 포커스 아닐 시 정지 이미지
---- meta.json            # 카드 내용에 대한 정형 데이터
---- title.svg            # 아티스트 이름
```

### meta.json 형식

```json
{
  "nameKo": "넬",
  "nameEn": "NELL",
  "description": "<p>카드 설명 <strong>HTML</strong></p>",
  "recommendedTracks": [
    { "title": "트랙 제목", "url": "https://..." },
    { "title": "url 없는 트랙" }
  ],
  "recommendedVideos": [
    { "title": "영상 제목", "url": "https://www.youtube.com/watch?v=..." }
  ]
}
```

| 필드                        | 필수 | 설명                                       |
| --------------------------- | ---- | ------------------------------------------ |
| `nameKo`                    | O    | 아티스트 한글 이름                         |
| `nameEn`                    | O    | 아티스트 영문 이름                         |
| `description`               | O    | 카드 설명 (리치 텍스트 에디터로 만든 HTML) |
| `recommendedTracks`         | O    | 추천 트랙 목록 (빈 배열 가능)              |
| `recommendedTracks[].title` | O    | 트랙 제목                                  |
| `recommendedTracks[].url`   | X    | `http://` 또는 `https://` 주소             |
| `recommendedVideos`         | X    | 추천 영상 목록                             |
| `recommendedVideos[].title` | O    | 영상 제목                                  |
| `recommendedVideos[].url`   | O    | `http://` 또는 `https://` 주소             |

- 문자열 필드는 빈 값이면 안 됩니다.
- `description` 에는 `p`, `strong`, `em`, `u`, `s`, `a`, `ul`, `ol`, `li`, `br` 만 씁니다. `script`, 이벤트 핸들러(`onclick` 등), `javascript:` 링크가 있으면 검증에 실패합니다.
- 직접 고치기보다는 아래 **최애 제작소 페이지**에서 편집하는 걸 권장합니다 (HTML 이스케이프를 알아서 처리).
- 형식은 `npm run validate`로 확인할 수 있습니다. 검사 규칙은 `src/validate.js`의 `validateMeta`에 있으니, 규칙을 바꾸면 이 문서도 함께 수정해 주세요.

### svg 레이어

`deco.svg`(선택), `title.svg` 는 Que 카드와 같은 좌표계(`viewBox="0 0 200 200"`)로 만들어야 이미지 위 위치가 맞습니다. 다르면 검증 시 경고가 나옵니다.

`deco.svg` 가 없으면 manifest 의 해당 카드에 `deco` 키가 빠집니다.

## 최애 제작소 페이지 (로컬 편집기)

```sh
npm run studio   # http://localhost:4000
```

`BIAS_CONTENT_DIR` 의 카드 폴더를 골라서 아래 작업을 할 수 있습니다.

- **카드 미리보기**: Que 의 `BiasCard` 와 같은 구조(160px, 이미지 + deco + title 레이어)로 기본(still)/포커스(motion) 상태를 같이 보여줍니다. bleed 영역(16px) 표시, 2배 보기 지원.
- **디테일 미리보기**: `image-detail.webp` 와 meta 내용을 보여줍니다. Que 에 디테일 화면이 아직 없어서 임시 레이아웃입니다.
- **meta.json 편집**: 이름, 설명(리치 텍스트, [Quill](https://quilljs.com/)), 추천 트랙/영상을 편집하고 `⌘S` 로 저장합니다. 저장 전에 `validate` 와 같은 규칙으로 검사합니다.
- **자동 갱신**: 카드 폴더의 파일(svg, webp, meta.json)이 바뀌면 미리보기가 바로 갱신됩니다. 편집 중인 내용은 덮어쓰지 않습니다.

참고

- 에디터(Quill)를 CDN 에서 불러오므로 인터넷 연결이 필요합니다. 연결이 안 되면 HTML 을 직접 입력하는 칸으로 대체됩니다.
- 서버는 `127.0.0.1` 에만 열립니다. 포트는 `BIAS_STUDIO_PORT` 로 바꿀 수 있습니다.
