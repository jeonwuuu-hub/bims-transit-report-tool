# BIMS 대중교통 현황표 자동화

부산시 버스정보시스템(BIMS) OpenAPI를 기준으로 사업지 반경 내 버스정류장, 정류장별 통과 노선, 노선별 운행현황표를 생성하는 로컬 웹툴입니다.

## 실행

```powershell
& 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\server.js
```

브라우저에서 `http://127.0.0.1:5177`을 엽니다.

## 사용 순서

1. 카카오맵 또는 네이버맵에서 사업지 중심 좌표를 확인합니다.
2. 사업지명, 중심 위도, 중심 경도, 반경을 입력합니다.
3. 공공데이터포털에서 승인받은 `부산광역시_부산버스정보시스템` 서비스키를 입력합니다.
4. `BIMS 조회`를 누릅니다.
5. 생성된 정류장별 운행노선표와 노선 운행현황표를 복사하거나 CSV로 저장합니다.

## 기준 데이터

- 정류장: BIMS `busStopList`
- 노선 운행정보: BIMS `busInfo`
- 노선별 경유 정류소: BIMS `busInfoByRouteId`

서비스키가 없을 때는 `샘플 실행`으로 화면과 내보내기 형식을 확인할 수 있습니다.

## 인터넷 링크로 배포

다른 사람이 링크로 접속하게 하려면 이 폴더를 GitHub 저장소에 올린 뒤 Render, Railway, Fly.io 같은 Node.js 웹서비스 호스팅에 배포합니다.

배포 환경변수:

- `BIMS_SERVICE_KEY`: 공공데이터포털 BIMS 서비스키. 이 값을 넣으면 사용자는 화면에서 서비스키를 입력하지 않아도 됩니다.
- `APP_ACCESS_CODE`: 선택사항. 설정하면 링크를 받은 사람도 이 접근 코드를 입력해야 BIMS 조회가 됩니다.
- `PORT`: 호스팅 서비스가 자동으로 넣는 경우가 많습니다. 로컬에서는 기본값 `5177`을 사용합니다.

배포 명령:

```bash
npm start
```

호스팅 서비스에서는 보통 `package.json`의 `start` 스크립트를 자동으로 사용합니다.
