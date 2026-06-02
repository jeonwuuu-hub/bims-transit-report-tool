# 부산 대중교통 현황표 자동생성 도구

카카오맵 기준 위도/경도와 반경을 입력하면 부산BIMS API를 호출해 부산 버스 정류장 위치도, 정류장 목록, 정류장별 경유노선, 노선별 운행현황 표를 생성하는 로컬 웹툴입니다.

## API 키 설정

API 키는 화면에 입력하지 않습니다. 아래 둘 중 하나로 서버에서 읽습니다.

1. `config.local.json` 파일

```json
{
  "apiKey": "공공데이터포털 부산BIMS 서비스키",
  "mapProvider": "osm",
  "kakaoJavascriptKey": "",
  "naverNcpKeyId": ""
}
```

2. 환경변수

```powershell
$env:DATA_GO_KR_API_KEY="공공데이터포털 부산BIMS 서비스키"
```

## 실행

```powershell
npm start
```

Node 실행 경로 문제가 있으면 아래 스크립트를 사용합니다.

```powershell
.\start-tool.ps1
```

브라우저에서 `http://localhost:5178`을 열고 위도, 경도, 반경을 입력합니다.

## 좌표 기준

- 입력 좌표: 카카오맵 위도/경도, WGS84(EPSG:4326)
- 결과 좌표: 캐드 수치지도용 CAD X/Y, Korea 2000 / East Belt 2010(EPSG:5187)
- CAD 표기는 `X=Easting`, `Y=Northing` 기준입니다.

## 배경지도

- 기본값은 API 키 없이 동작하는 OpenStreetMap 배경지도입니다.
- 카카오맵을 쓰려면 `mapProvider`를 `kakao`로 바꾸고 `kakaoJavascriptKey`에 카카오 지도 JavaScript 키를 입력합니다.
- 네이버맵을 쓰려면 `mapProvider`를 `naver`로 바꾸고 `naverNcpKeyId`에 네이버 지도 `ncpKeyId`를 입력합니다.

## 데이터 기준

- 정류소 목록: 부산광역시 부산버스정보시스템 `busStopList`
- 정류장별 경유노선: 부산광역시 부산버스정보시스템 도착정보 및 `busInfoByRouteId`
- 노선 운행현황: 부산광역시 부산버스정보시스템 `busInfo`

## 메모

- `config.local.json`은 `.gitignore`에 포함되어 있습니다.
- 입력 위도/경도는 소수점 14자리 수준으로 처리하고, 결과 CAD 좌표는 m 단위 소수점 3자리까지 표시합니다.
- 생성된 표는 한글/워드/엑셀에 붙여넣거나 `.xls` 형식으로 저장할 수 있습니다.
