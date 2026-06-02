# Render 배포 가이드

이 문서는 BIMS 대중교통 현황표 웹툴을 Render에 올려서 PC가 꺼져도 접속 가능한 고정 링크를 만드는 순서입니다.

## 준비물

- GitHub 계정
- Render 계정
- BIMS 공공데이터 인증키
- 접근코드로 사용할 짧은 비밀번호 예: `bims2026`

## 1. ZIP 파일 압축 풀기

1. `bims-transit-report-tool.zip` 파일을 다운로드합니다.
2. ZIP 파일을 우클릭합니다.
3. `압축 풀기` 또는 `Extract All`을 누릅니다.
4. 압축이 풀린 폴더 안에 아래 파일들이 있는지 확인합니다.

업로드해야 하는 파일과 폴더:

- `server.js`
- `package.json`
- `render.yaml`
- `.gitignore`
- `.env.example`
- `README.md`
- `DEPLOY_RENDER.md`
- `public` 폴더 전체

업로드하면 안 되는 파일:

- `.env`

`.env`에는 개인 인증키가 들어갈 수 있으므로 GitHub에 올리면 안 됩니다.

## 2. GitHub 계정 만들기

1. 브라우저에서 `https://github.com`에 들어갑니다.
2. 오른쪽 위 `Sign up`을 누릅니다.
3. 이메일, 비밀번호, 사용자 이름을 입력합니다.
4. 이메일 인증을 완료합니다.
5. 로그인된 상태가 되면 GitHub 준비가 끝납니다.

## 3. GitHub 저장소 만들기

1. GitHub 오른쪽 위 `+` 버튼을 누릅니다.
2. `New repository`를 누릅니다.
3. `Repository name`에 `bims-transit-report-tool`을 입력합니다.
4. `Public` 또는 `Private` 중 하나를 고릅니다.
   - 처음이면 `Public`이 Render 연결이 가장 쉽습니다.
   - 코드에 인증키는 들어가지 않으므로 Public이어도 괜찮습니다.
5. `Add a README file`은 체크하지 않아도 됩니다.
6. 아래쪽 `Create repository`를 누릅니다.

## 4. GitHub에 파일 올리기

1. 새 저장소 화면에서 `uploading an existing file` 링크를 누릅니다.
   - 보이지 않으면 `Add file` > `Upload files`를 누릅니다.
2. 압축을 풀어둔 폴더 안의 업로드 대상 파일과 `public` 폴더를 끌어다 놓습니다.
3. `.env` 파일은 절대 올리지 않습니다.
4. 아래 `Commit changes` 버튼을 누릅니다.
5. 파일 목록에 `server.js`, `package.json`, `render.yaml`, `public` 폴더가 보이면 성공입니다.

## 5. Render 계정 만들기

1. 브라우저에서 `https://render.com`에 들어갑니다.
2. 오른쪽 위 `Get Started` 또는 `Sign Up`을 누릅니다.
3. `GitHub`로 가입 또는 로그인을 선택합니다.
4. Render가 GitHub 접근 권한을 요청하면 승인합니다.

## 6. Render에서 Web Service 만들기

1. Render Dashboard로 들어갑니다.
2. 오른쪽 위 `New +` 버튼을 누릅니다.
3. `Web Service`를 누릅니다.
4. GitHub 저장소 목록에서 `bims-transit-report-tool`을 찾습니다.
5. 저장소 오른쪽의 `Connect`를 누릅니다.

## 7. Render 설정값 입력

서비스 생성 화면에서 아래처럼 입력합니다.

- Name: `bims-transit-report-tool`
- Region: 가까운 곳 아무거나 선택
- Branch: `main`
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Instance Type: 무료로 시작하면 `Free`

## 8. 환경변수 입력

Render 서비스 생성 화면 아래쪽 또는 생성 후 왼쪽 메뉴 `Environment`에서 환경변수를 추가합니다.

필수:

- Key: `BIMS_SERVICE_KEY`
- Value: 본인의 BIMS 공공데이터 인증키

필수:

- Key: `APP_ACCESS_CODE`
- Value: 링크 사용자에게 알려줄 접근코드 예: `bims2026`

권장:

- Key: `NODE_VERSION`
- Value: `22`

인증키는 코드 파일에 넣지 말고 반드시 Render 환경변수에만 넣습니다.

## 9. 배포 시작

1. `Create Web Service`를 누릅니다.
2. Render가 자동으로 배포를 시작합니다.
3. 로그에 `BIMS report tool` 같은 문구가 보이면 서버가 실행된 것입니다.
4. 화면 위쪽 또는 서비스 상세 화면에 `https://...onrender.com` 주소가 생깁니다.

## 10. 접속 테스트

1. Render가 준 `https://...onrender.com` 주소를 엽니다.
2. 접근코드 입력 화면이 나오면 `APP_ACCESS_CODE`에 넣은 값을 입력합니다.
3. 화면이 열리면 `샘플 실행`을 눌러 표가 생성되는지 확인합니다.
4. 실제 업무에서는 사업지 좌표와 반경을 넣고 `BIMS 조회`를 누릅니다.

## 자주 생기는 문제

`접근 코드가 올바르지 않습니다.`

- Render 환경변수 `APP_ACCESS_CODE`와 입력한 코드가 같은지 확인합니다.

`BIMS 서비스키가 필요합니다.`

- Render 환경변수 `BIMS_SERVICE_KEY`가 비어 있거나 오타가 있는 상태입니다.

첫 접속이 느립니다.

- Render 무료 플랜은 사용하지 않으면 잠들 수 있습니다. 첫 접속 때 30초 이상 걸릴 수 있습니다.

GitHub에 `.env`를 올렸습니다.

- 저장소에서 `.env`를 삭제하고, BIMS 인증키를 재발급하는 것이 안전합니다.
