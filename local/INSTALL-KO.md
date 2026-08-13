# 후배용 설치 안내

이 압축파일에는 소스만 들어 있습니다. 선배의 계정, 비밀번호, 로그인
세션은 포함되지 않습니다. 설치하는 사람마다 반드시 자기 학교 계정을
자기 컴퓨터에 직접 저장해야 합니다.

## 공통 설치

1. Node.js 20 이상을 설치합니다.
2. 받은 압축파일을 풀고 그 폴더에서 터미널을 엽니다.
3. 다음 세 줄을 순서대로 실행합니다.

```bash
npm ci
npm run build
npm run build:khu-helper
npm run setup:khu
```

마지막 명령에서 본인의 KHU ID와 비밀번호를 입력합니다. 비밀번호는
화면에 표시되지 않으며 확인을 위해 두 번 입력합니다. 채팅, 이메일,
메신저에는 비밀번호를 보내지 마세요.

빌드가 끝나면 저장소 전체를 로컬 플러그인 마켓플레이스로 추가하고
UniPaper 플러그인 하나를 설치합니다. 아래 경로는 압축을 푼 실제 폴더의
절대 경로로 바꿉니다.

```bash
codex plugin marketplace add /absolute/path/to/unipaper-bridge
codex plugin add unipaper-bridge@unipaper-local
```

Codex 데스크톱 앱을 다시 시작하고 새 대화를 만듭니다. 이 플러그인 하나가
일반 논문 조사 스킬, 공개 UniPaper MCP, 로컬 `open_khu_paper`를 모두
연결합니다. 사용자가 KHU 도구를 따로 지시할 필요는 없습니다.

Codex는 일반 학술검색과 합법적인 공개 원문을 먼저 시도합니다. 답변에
실제 원문이 필요한데 공개 원문을 읽을 수 없을 때만 KHU 전용 브라우저를
자동으로 엽니다. 유료 원문은 MCP로 복사되지 않으므로, 열린 브라우저에서
개별 PDF를 합법적으로 받은 뒤 현재 대화에 첨부하는 마지막 동작만 사용자가
수행합니다. Codex는 그 PDF가 도착하면 원래 분석을 이어갑니다.

## macOS

처음 개발 도구 설치가 필요하면 다음 명령을 한 번 실행합니다.

```bash
xcode-select --install
```

비밀번호를 읽을 때마다 Touch ID를 요구하려면 일반 설정 명령 대신
다음을 사용합니다.

```bash
npm run setup:khu -- --touch-id
```

계정은 동기화가 꺼진 macOS Keychain에 저장됩니다.

## Windows 10/11

PowerShell에서 공통 설치 명령을 그대로 실행합니다. 설정 과정에서 전용
Chromium도 자동으로 내려받습니다. 계정은 현재 Windows 사용자만 풀 수
있는 DPAPI로 암호화됩니다. 암호화 파일이나 전용 브라우저 폴더를 다른
사람에게 복사하지 마세요.

## Linux 데스크톱

Ubuntu/Debian은 먼저 다음 패키지를 설치합니다.

```bash
sudo apt install libsecret-tools
```

그다음 공통 설치 명령을 실행합니다. GNOME Keyring 또는 Secret Service를
지원하는 KDE 지갑이 로그인된 상태여야 합니다. 화면과 데스크톱 키링이
없는 서버에서는 안전한 저장을 보장할 수 없어 지원하지 않습니다.

Chromium이 운영체제 라이브러리가 부족하다고 알리면 다음을 실행한 뒤
설정을 다시 시도합니다.

```bash
cd local/khu-auth-helper-portable
sudo npx playwright install-deps chromium
```

## 상태 확인과 삭제

다음 명령은 계정 내용을 보여 주지 않고 설정 여부만 알려 줍니다.

```bash
npm run status:khu
```

저장한 계정을 지우려면 다음을 실행합니다.

```bash
npm run remove:khu
```

## 공유할 때 지킬 것

- 이 소스 압축파일 또는 공식 저장소 링크만 전달합니다.
- Keychain 항목, Windows 암호화 파일, Linux 키링, 전용 브라우저 프로필은
  전달하지 않습니다.
- 학교 계정은 양도하거나 여러 사람이 함께 쓰지 않습니다.
- 개인 계정으로 허용된 논문만 열고, 전권·이슈 단위 자동 다운로드나
  재배포를 하지 않습니다.

더 자세한 보안 설계와 개발자용 검증 방법은 `local/README.md`에 있습니다.
