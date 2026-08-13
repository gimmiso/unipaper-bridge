# UniPaper Bridge

논문을 일반 학술검색 흐름으로 조사하고, 합법적인 오픈액세스(OA) 원문을
먼저 읽은 뒤, 필요한 원문을 끝내 읽을 수 없을 때만 사용자의 로컬 대학
접속을 자동으로 여는 오픈소스 MCP 서버 + ChatGPT/Codex 플러그인입니다.

현재 0.1 MVP에는 경희대학교 서울캠퍼스와 국제캠퍼스 어댑터가 들어 있습니다. 다른 대학은 공개된 교외접속 규정을 확인한 뒤 `src/institutions.ts`에 어댑터를 추가할 수 있습니다.

## 바로 연결하기

공개 배포된 MCP 주소:

```text
https://unipaper-bridge-mcp.kimmiso0821.chatgpt.site/api/mcp
```

상태 페이지는 [unipaper-bridge-mcp.kimmiso0821.chatgpt.site](https://unipaper-bridge-mcp.kimmiso0821.chatgpt.site), 상태 확인 API는 [`/healthz`](https://unipaper-bridge-mcp.kimmiso0821.chatgpt.site/healthz)입니다.

ChatGPT에서 **Settings → Security and login → Developer mode**를 켠 뒤 Plugins에서 새 연결을 추가하고 위 MCP 주소 전체를 입력하세요. 연결 시 `resolve_paper`, `find_open_access`, `list_institutions`, `build_institution_link` 네 도구가 표시되어야 합니다.

현재 공개 배포에서는 Crossref 조회와 경희대 링크 생성이 활성화되어 있습니다. `find_open_access`는 운영 환경에 `OPENALEX_API_KEY`가 설정되기 전까지 안전한 구성 오류를 반환합니다.

## 안전 경계

이 서버가 하는 일:

- Crossref에서 DOI/제목 메타데이터 조회
- OpenAlex에서 보고된 OA 위치 조회
- 공식 대학 프록시 규칙으로 사용자에게 보여 줄 접속 링크 생성

이 서버가 하지 않는 일:

- 대학 아이디·비밀번호·MFA·쿠키·세션 수집
- 사용자의 Chrome 로그인 세션 상속
- 대학 또는 출판사에 대신 로그인
- 유료 PDF 다운로드·저장·재배포
- 저널/이슈 단위 자동 다운로드

```mermaid
flowchart TD
    A["DOI 또는 제목"] --> B["MCP: 논문 식별"]
    B --> C{"OA 원문 있음?"}
    C -->|예| D["합법적 OA 링크"]
    C -->|아니오| E{"답변에 원문이 꼭 필요?"}
    E -->|아니오| I["초록·메타데이터 한계 표시"]
    E -->|예| F["로컬 KHU 브라우저 자동 실행"]
    F --> G["사용자가 개별 PDF만 대화에 첨부"]
    D --> H["근거 기반 분석"]
    G --> H
```

## 제공 도구

| 도구 | 역할 | 외부 데이터 | 상태 변경 |
|---|---|---:|---:|
| `resolve_paper` | DOI 또는 제목으로 Crossref 메타데이터 식별 | Crossref | 없음 |
| `find_open_access` | DOI의 OA 위치 확인 | OpenAlex | 없음 |
| `list_institutions` | 지원 대학·캠퍼스와 공식 정책 나열 | 없음 | 없음 |
| `build_institution_link` | 승인된 어댑터로 접속 링크 생성 | 없음 | 없음 |

모든 도구는 read-only이며, `build_institution_link`는 URL을 서버에서 열지 않습니다.

## 선택 사항: macOS·Windows·Linux 로컬 KHU 로그인 헬퍼

공개 MCP의 인증 경계는 그대로 유지하면서, 사용자 컴퓨터의 운영체제 보안 저장소를 이용하는 별도 로컬 컴포넌트가 [`local/`](local/README.md)에 있습니다. macOS는 Keychain, Windows는 현재 사용자 범위 DPAPI, Linux 데스크톱은 Secret Service를 사용합니다.

```text
공개 MCP → 경희대 접속 URL만 생성
로컬 MCP → 네이티브 헬퍼 창만 실행
격리된 헬퍼 → 전용 브라우저 세션 우선, 필요할 때만 OS 보안 저장소 조회
```

로컬 MCP에는 `open_khu_paper`만 있으며 비밀번호 조회 도구는 없습니다. ID·비밀번호·쿠키·세션은 MCP 결과, 모델 응답, 명령행 인자, `.env`에 들어가지 않습니다. `local/` 전체는 Docker 배포에서 제외되어 클라우드 서버에 포함되지 않습니다.

사용자가 KHU 스킬이나 도구를 따로 선택하는 구조가 아닙니다. 논문 관련
요청에서 `institutional-paper-reader`가 일반 검색과 공개 원문을 먼저
처리하고, 실제 원문이 분석에 필요한데 읽을 수 없을 때만
`open_khu_paper`를 자동 호출합니다. 브라우저가 열렸다는 상태만으로 원문을
읽었다고 간주하지 않으며, 유료 원문 분석에는 사용자가 그 브라우저에서
합법적으로 받은 개별 PDF를 현재 대화에 첨부하는 마지막 단계만 남습니다.

처음 한 번만 자신의 컴퓨터 터미널에서 실행하세요. 비밀번호 입력은 화면에 표시되지 않습니다.

```bash
npm ci
npm run build
npm run build:khu-helper
npm run setup:khu
```

macOS에서 매번 credential 사용 시 Touch ID를 요구하려면 `npm run setup:khu -- --touch-id`를 사용합니다. Windows와 Linux 설치 조건, 로컬 MCP 설치와 보안 검증 방법은 [`local/README.md`](local/README.md)를 따르세요.

후배에게는 소스 저장소나 릴리스 압축파일만 공유하세요. 설정된 헬퍼, 브라우저 프로필, Keychain/DPAPI/Secret Service 데이터는 공유하지 않으며, 각 사용자가 자신의 컴퓨터에서 자신의 학교 계정으로 `npm run setup:khu`를 실행해야 합니다.

후배에게 전달할 간단한 운영체제별 설명은 [`local/INSTALL-KO.md`](local/INSTALL-KO.md)에 정리되어 있습니다.

## 로컬 실행 (macOS 포함)

준비물은 Node.js 20 이상과 무료 OpenAlex API 키입니다.

```bash
npm ci
cp .env.example .env
# .env에 OPENALEX_API_KEY를 입력
npm run check
npm start
```

기본 엔드포인트는 `http://127.0.0.1:3000/mcp`, 상태 확인은 `http://127.0.0.1:3000/healthz`입니다.

stdio 방식은 다음과 같습니다.

```bash
npm run build
node dist/index.js --stdio
```

MCP Inspector로 도구 목록과 호출 결과를 확인할 수 있습니다.

```bash
npx @modelcontextprotocol/inspector@latest
```

Inspector에서 command를 `node`, arguments를 `dist/index.js --stdio`로 설정하세요.

## ChatGPT/Codex 플러그인으로 로컬 설치

프로젝트에는 다음 파일이 포함됩니다.

- `.codex-plugin/plugin.json`: 플러그인 매니페스트
- `.mcp.json`: 번들된 stdio MCP 설정
- `skills/institutional-paper-reader/`: 논문 접근·분석 워크플로
- `.agents/plugins/marketplace.json`: 로컬 마켓플레이스

먼저 `npm ci`, `npm run build`, `npm run build:khu-helper`를 실행합니다.
그다음 저장소 전체를 로컬 마켓플레이스로 추가하고 플러그인 하나를
설치합니다. 이 한 설치에 두 연구 스킬, 공개 MCP, 로컬 KHU MCP가 모두
포함됩니다.

```bash
codex plugin marketplace add /absolute/path/to/unipaper-bridge
codex plugin add unipaper-bridge@unipaper-local
```

Git 저장소만 직접 마켓플레이스로 추가하면 빌드 산출물이 없으므로 로컬 MCP를
실행할 수 없습니다. 다른 사용자도 저장소를 먼저 clone하고 위 빌드 명령을
실행한 뒤, clone한 절대 경로를 마켓플레이스로 추가해야 합니다.

## 공개 ChatGPT 플러그인으로 배포

공개 ChatGPT 연결은 로컬 stdio가 아니라 안정적인 HTTPS Streamable HTTP 엔드포인트가 필요합니다.

1. 위 공개 MCP 주소를 사용하거나 [배포 가이드](docs/DEPLOYMENT.md)에 따라 직접 HTTPS로 배포합니다.
2. ChatGPT 설정에서 Developer mode를 켜고 MCP URL을 연결합니다.
3. 생성된 `plugin_asdk_app...` 기술 ID로 `.app.json`을 추가합니다.
4. 운영자 신원, 공개 웹사이트, 개인정보처리방침·이용약관 URL, 지원 연락처를 매니페스트에 채웁니다.
5. 도구 스캔과 `evals/cases.json` 평가를 통과시킨 뒤 공개 디렉터리에 제출합니다.

0.1 서버는 사용자별 비공개 데이터를 읽거나 쓰지 않는 익명 read-only 서비스이므로 대학 OAuth를 구현하지 않습니다. 향후 서버가 개인 Zotero나 파일 저장소를 읽게 된다면 해당 기능에는 OAuth 2.1과 사용자별 권한 검사가 필요합니다.

## 경희대학교 어댑터

- 공식 교외접속 안내: https://lib.khu.ac.kr/webcontent/info/1
- 공식 공정이용 안내: https://lib.khu.ac.kr/webcontent/info/2
- 서울: `https://openlink.khu.ac.kr/link.n2s?url=`
- 국제: `https://webgate.khu.ac.kr/link.n2s?url=`

경희대 안내는 동일 출판사 기준 동일 PC/IP에서 1일 30건 이하, 전권·이슈 전체 다운로드 금지, 프로그램을 통한 지속 다운로드 금지, 계정 양도와 재배포 금지를 명시합니다. 이 프로젝트는 안전 여유를 두어 하루 20건을 작업상 상한으로 안내하지만 다운로드를 추적하거나 실행하지는 않습니다.

## 다른 대학 추가

`skills/institutional-paper-reader/references/adding-institutions.md`의 체크리스트를 따르세요. 반드시 대학 공식 공개 문서에서 링크 규칙과 이용 정책을 확인하고, 실제 계정·쿠키·사설 세션 URL·유료 PDF를 커밋하지 마세요.

## 개발

```bash
npm test
npm run build
npm run check
```

현재 테스트는 DOI 정규화, Crossref/OpenAlex 응답 변환, URL 안전성, KHU 링크 생성, MCP 도구 스키마와 안전 주석을 검증합니다.

크로스플랫폼 로컬 헬퍼까지 검증하려면 `npm run check:local`을 추가로 실행합니다. 실제 비밀번호 없이 출력 차단, 허용 URL, 세션 우선 접근, 로컬 MCP 도구 계약을 검사합니다.

현재 공개 배포에 사용된 buildless Worker 구현은 [`deploy/sites-worker.js`](deploy/sites-worker.js)에 함께 공개되어 있습니다. Node/Express 서버와 동일한 네 도구 및 브라우저 인증 경계를 유지하며 공개 엔드포인트는 `/api/mcp`입니다.

## English summary

UniPaper Bridge is a privacy-preserving MCP server and plugin that resolves scholarly metadata, checks reported open-access locations, and creates institution-specific links. University authentication remains entirely in each user's browser; the server never handles credentials, browser sessions, or licensed PDFs.

## Licence

MIT. 기관 구독 콘텐츠 자체에는 이 라이선스가 적용되지 않으며, 사용자는 각 도서관·출판사·저작권 조건을 따라야 합니다.
