const form = document.querySelector("#reportForm");
const statusBox = document.querySelector("#status");
const summaryBox = document.querySelector("#summary");
const tablesBox = document.querySelector("#tables");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const runButton = document.querySelector("#runButton");

const CIRCLED = [
  "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
  "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"
];

let currentReport = null;
let mapConfig = { provider: "osm" };
const mapConfigPromise = loadMapConfig();
const scriptPromises = new Map();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = {
    lat: Number(formData.get("lat")),
    lng: Number(formData.get("lng")),
    radius: Number(formData.get("radius") || 500)
  };

  setBusy(true);
  setStatus("부산BIMS 조회 중입니다. 첫 실행은 정류소/노선 색인을 만들기 때문에 시간이 조금 걸릴 수 있습니다.");
  summaryBox.innerHTML = "";
  tablesBox.innerHTML = "";
  copyButton.disabled = true;
  downloadButton.disabled = true;

  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "보고서 생성 실패");

    currentReport = data;
    renderReport(data);
    copyButton.disabled = false;
    downloadButton.disabled = false;
    setStatus("표 생성이 완료되었습니다.");
  } catch (error) {
    currentReport = null;
    setStatus(error.message || "오류가 발생했습니다.", true);
  } finally {
    setBusy(false);
  }
});

copyButton.addEventListener("click", async () => {
  if (!currentReport) return;
  const html = buildExportHtml(currentReport);
  const plain = buildPlainText(currentReport);
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" })
    })
  ]);
  setStatus("표를 클립보드에 복사했습니다. 한글/워드/엑셀에 붙여넣을 수 있습니다.");
});

downloadButton.addEventListener("click", () => {
  if (!currentReport) return;
  const html = buildExportHtml(currentReport, true);
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `busan-transit-report-${new Date().toISOString().slice(0, 10)}.xls`;
  link.click();
  URL.revokeObjectURL(url);
});

function setBusy(isBusy) {
  runButton.disabled = isBusy;
  runButton.textContent = isBusy ? "생성 중..." : "표 생성";
}

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
}

function renderReport(report) {
  summaryBox.innerHTML = [
    metric("정류장", `${report.summary.stopCount}개`),
    metric("전체 노선", `${report.summary.routeCount}개`),
    metric("일반/급행/좌석", `${report.summary.regularCount}개`),
    metric("마을버스", `${report.summary.villageCount}개`)
  ].join("");

  tablesBox.innerHTML = [
    section("정류장 위치도", renderStopMap(report)),
    section("정류장 목록", renderStopList(report.stops)),
    section("정류장별 운행노선", renderStopRouteTable(report.stopRouteTable)),
    section("노선별 운행현황", renderRouteOperationTable(report.routeOperationTable))
  ].join("");

  initBaseMap(report);
}

function metric(label, value) {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function section(title, content) {
  return `<article class="table-section"><div class="section-head"><h2>${escapeHtml(title)}</h2></div>${content}</article>`;
}

function renderStopMap(report) {
  return `
    <div class="map-wrap">
      <div id="baseMap" class="base-map">
        <div class="map-loading">배경지도를 불러오는 중입니다.</div>
      </div>
      <div class="map-meta">
        <span>입력좌표 ${formatCoord(report.center.lat)}, ${formatCoord(report.center.lng)}</span>
        <span>CAD좌표 ${formatCadPair(report.center.cad)}</span>
        <span>반경 ${report.radius}m</span>
        <span>${escapeHtml(getCadSystemLabel(report))}</span>
        <span id="mapProviderLabel">지도 기준 확인 중</span>
      </div>
    </div>
  `;
}

function renderStaticMap(report) {
  const width = 960;
  const height = 620;
  const padding = 52;
  const centerX = width / 2;
  const centerY = height / 2;
  const usable = Math.min(width, height) - padding * 2;
  const scale = usable / (report.radius * 2);
  const metersPerLat = 111320;
  const metersPerLng = 111320 * Math.cos((report.center.lat * Math.PI) / 180);
  const radiusPx = report.radius * scale;

  const markers = report.stops.map((stop) => {
    const x = centerX + (stop.lng - report.center.lng) * metersPerLng * scale;
    const y = centerY - (stop.lat - report.center.lat) * metersPerLat * scale;
    return `
      <g class="stop-marker" transform="translate(${round(x)}, ${round(y)})">
        <circle r="12"></circle>
        <text y="4">${escapeHtml(stop.pointNo)}</text>
        <title>${escapeHtml(`${stop.pointNo}. ${stop.name} / CAD ${formatCadPair(stop.cad)}`)}</title>
      </g>
    `;
  }).join("");

  return `
    <div class="map-wrap">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="사업지 반경 내 버스정류장 위치도">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#dde6ec" stroke-width="1"></path>
          </pattern>
        </defs>
        <rect width="${width}" height="${height}" fill="#f7fafc"></rect>
        <rect width="${width}" height="${height}" fill="url(#grid)"></rect>
        <line x1="${centerX}" y1="${padding}" x2="${centerX}" y2="${height - padding}" stroke="#b7c5d0" stroke-dasharray="5 6"></line>
        <line x1="${padding}" y1="${centerY}" x2="${width - padding}" y2="${centerY}" stroke="#b7c5d0" stroke-dasharray="5 6"></line>
        <circle cx="${centerX}" cy="${centerY}" r="${radiusPx}" fill="rgba(23, 107, 135, 0.08)" stroke="#176b87" stroke-width="2"></circle>
        ${markers}
        <g class="site-marker" transform="translate(${centerX}, ${centerY})">
          <rect x="-22" y="-22" width="44" height="44" rx="4" transform="rotate(45)" />
          <text y="5">사업지</text>
        </g>
      </svg>
      <div class="map-meta">
        <span>입력좌표 ${formatCoord(report.center.lat)}, ${formatCoord(report.center.lng)}</span>
        <span>CAD좌표 ${formatCadPair(report.center.cad)}</span>
        <span>반경 ${report.radius}m</span>
        <span>${escapeHtml(getCadSystemLabel(report))}</span>
        <span>좌표 도식 위치도</span>
      </div>
    </div>
  `;
}

async function loadMapConfig() {
  try {
    const response = await fetch("/api/map-config");
    if (!response.ok) throw new Error("map config failed");
    mapConfig = await response.json();
  } catch {
    mapConfig = { provider: "osm" };
  }
  return mapConfig;
}

async function initBaseMap(report) {
  const container = document.querySelector("#baseMap");
  if (!container) return;

  await mapConfigPromise;
  container.innerHTML = "";

  try {
    if (mapConfig.provider === "kakao" && mapConfig.kakaoJavascriptKey) {
      await renderKakaoMap(container, report, mapConfig.kakaoJavascriptKey);
      setMapProviderLabel("카카오맵 배경지도");
      return;
    }

    if (mapConfig.provider === "naver" && mapConfig.naverNcpKeyId) {
      await renderNaverMap(container, report, mapConfig.naverNcpKeyId);
      setMapProviderLabel("네이버맵 배경지도");
      return;
    }

    renderOsmMap(container, report);
    setMapProviderLabel("OpenStreetMap 배경지도");
  } catch {
    renderOsmMap(container, report);
    setMapProviderLabel("OpenStreetMap 배경지도");
  }
}

function setMapProviderLabel(text) {
  const label = document.querySelector("#mapProviderLabel");
  if (label) label.textContent = text;
}

function loadScriptOnce(src) {
  if (!scriptPromises.has(src)) {
    scriptPromises.set(src, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    }));
  }
  return scriptPromises.get(src);
}

async function renderKakaoMap(container, report, key) {
  await loadScriptOnce(`https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=${encodeURIComponent(key)}`);
  await new Promise((resolve) => window.kakao.maps.load(resolve));

  const center = new window.kakao.maps.LatLng(report.center.lat, report.center.lng);
  const map = new window.kakao.maps.Map(container, {
    center,
    level: levelForRadius(report.radius)
  });
  const bounds = new window.kakao.maps.LatLngBounds();
  bounds.extend(center);

  new window.kakao.maps.Circle({
    center,
    radius: report.radius,
    strokeWeight: 2,
    strokeColor: "#176b87",
    strokeOpacity: 0.9,
    fillColor: "#176b87",
    fillOpacity: 0.12,
    map
  });

  new window.kakao.maps.CustomOverlay({
    position: center,
    content: '<div class="map-site-marker">사업지</div>',
    yAnchor: 0.5,
    map
  });

  for (const stop of report.stops) {
    const position = new window.kakao.maps.LatLng(stop.lat, stop.lng);
    bounds.extend(position);
    new window.kakao.maps.CustomOverlay({
      position,
      content: `<div class="map-stop-marker" title="${escapeHtml(stop.name)}">${escapeHtml(stop.pointNo)}</div>`,
      yAnchor: 0.5,
      map
    });
  }

  if (report.stops.length) map.setBounds(bounds);
}

async function renderNaverMap(container, report, key) {
  await loadScriptOnce(`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(key)}`);

  const center = new window.naver.maps.LatLng(report.center.lat, report.center.lng);
  const map = new window.naver.maps.Map(container, {
    center,
    zoom: zoomForRadius(report.radius, report.center.lat, container.clientWidth, container.clientHeight)
  });
  const bounds = new window.naver.maps.LatLngBounds(center, center);

  new window.naver.maps.Circle({
    map,
    center,
    radius: report.radius,
    strokeColor: "#176b87",
    strokeOpacity: 0.9,
    strokeWeight: 2,
    fillColor: "#176b87",
    fillOpacity: 0.12
  });

  new window.naver.maps.Marker({
    map,
    position: center,
    icon: {
      content: '<div class="map-site-marker">사업지</div>',
      anchor: new window.naver.maps.Point(25, 18)
    }
  });

  for (const stop of report.stops) {
    const position = new window.naver.maps.LatLng(stop.lat, stop.lng);
    bounds.extend(position);
    new window.naver.maps.Marker({
      map,
      position,
      icon: {
        content: `<div class="map-stop-marker" title="${escapeHtml(stop.name)}">${escapeHtml(stop.pointNo)}</div>`,
        anchor: new window.naver.maps.Point(13, 13)
      }
    });
  }

  if (report.stops.length) map.fitBounds(bounds);
}

function renderOsmMap(container, report) {
  const width = container.clientWidth || 900;
  const height = container.clientHeight || 560;
  const zoom = zoomForRadius(report.radius, report.center.lat, width, height);
  const center = latLngToWorld(report.center.lat, report.center.lng, zoom);
  const topLeft = { x: center.x - width / 2, y: center.y - height / 2 };
  const minTileX = Math.floor(topLeft.x / 256);
  const maxTileX = Math.floor((topLeft.x + width) / 256);
  const minTileY = Math.floor(topLeft.y / 256);
  const maxTileY = Math.floor((topLeft.y + height) / 256);
  const tileCount = 2 ** zoom;
  const metersPerPixel = 156543.03392 * Math.cos((report.center.lat * Math.PI) / 180) / tileCount;
  const radiusPx = report.radius / metersPerPixel;

  container.innerHTML = "";
  container.classList.add("osm-map");

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCount) continue;
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const img = document.createElement("img");
      img.className = "osm-tile";
      img.src = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`;
      img.alt = "";
      img.style.left = `${Math.round(tileX * 256 - topLeft.x)}px`;
      img.style.top = `${Math.round(tileY * 256 - topLeft.y)}px`;
      container.appendChild(img);
    }
  }

  const radius = document.createElement("div");
  radius.className = "osm-radius";
  radius.style.width = `${radiusPx * 2}px`;
  radius.style.height = `${radiusPx * 2}px`;
  radius.style.left = `${width / 2 - radiusPx}px`;
  radius.style.top = `${height / 2 - radiusPx}px`;
  container.appendChild(radius);

  const site = document.createElement("div");
  site.className = "map-site-marker";
  site.textContent = "사업지";
  site.style.left = `${width / 2}px`;
  site.style.top = `${height / 2}px`;
  container.appendChild(site);

  for (const stop of report.stops) {
    const point = latLngToWorld(stop.lat, stop.lng, zoom);
    const marker = document.createElement("div");
    marker.className = "map-stop-marker";
    marker.textContent = stop.pointNo;
    marker.title = `${stop.pointNo}. ${stop.name} / CAD ${formatCadPair(stop.cad)}`;
    marker.style.left = `${point.x - topLeft.x}px`;
    marker.style.top = `${point.y - topLeft.y}px`;
    container.appendChild(marker);
  }

  const attribution = document.createElement("div");
  attribution.className = "osm-attribution";
  attribution.textContent = "© OpenStreetMap contributors";
  container.appendChild(attribution);
}

function latLngToWorld(lat, lng, zoom) {
  const scale = 256 * 2 ** zoom;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  };
}

function zoomForRadius(radius, lat, width, height) {
  const targetPixels = Math.min(width || 900, height || 560) * 0.42;
  for (let zoom = 19; zoom >= 10; zoom -= 1) {
    const metersPerPixel = 156543.03392 * Math.cos((lat * Math.PI) / 180) / (2 ** zoom);
    if (radius / metersPerPixel <= targetPixels) return zoom;
  }
  return 10;
}

function levelForRadius(radius) {
  if (radius <= 120) return 3;
  if (radius <= 250) return 4;
  if (radius <= 500) return 5;
  if (radius <= 1000) return 6;
  return 7;
}

function renderStopList(stops) {
  const rows = stops.map((stop) => {
    const cad = getCadCoord(stop);
    return `
      <tr>
        <td>${stop.pointNo}</td>
        <td>${escapeHtml(stop.name)}</td>
        <td>${escapeHtml(stop.arsNo || "-")}</td>
        <td>${escapeHtml(stop.nodeId)}</td>
        <td>${stop.distance}</td>
        <td>${formatCad(cad.x)}</td>
        <td>${formatCad(cad.y)}</td>
      </tr>
    `;
  }).join("");
  return table(["지점", "정류소명", "정류소번호", "정류소ID", "거리(m)", "CAD X", "CAD Y"], rows);
}

function renderStopRouteTable(rows) {
  const groupedRows = groupStopRoutes(rows);
  const body = groupedRows.map((row) => `
    <tr>
      <td>${row.pointNos.map(circled).join(", ")}</td>
      <td>${escapeHtml(row.stopNames.join(", "))}</td>
      <td>${escapeHtml(row.routes.join(", "))}</td>
    </tr>
  `).join("");
  return table(["조사지점", "정류소명", "운행노선"], body);
}

function renderRouteOperationTable(routes) {
  const body = routes.map((route) => `
    <tr>
      <td>${escapeHtml(route.routeGroup)}</td>
      <td>${escapeHtml(route.routeNo)}</td>
      <td>${escapeHtml(route.startNodeName)}</td>
      <td>${escapeHtml(route.endNodeName)}</td>
      <td>${escapeHtml(route.firstTime)}</td>
      <td>${escapeHtml(route.lastTime)}</td>
      <td>${escapeHtml(route.peakInterval)}</td>
      <td>${escapeHtml(route.normalInterval)}</td>
      <td>${escapeHtml(route.holidayInterval)}</td>
    </tr>
  `).join("");
  return `${table(["구분", "노선번호", "기점", "종점", "첫차", "막차", "출퇴근", "평일", "휴일"], body)}
    <p class="source-note">자료: 부산시 버스정보시스템</p>`;
}

function table(headers, bodyRows) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>${bodyRows || `<tr><td colspan="${headers.length}">조회 결과가 없습니다.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function buildExportHtml(report, fullDocument = false) {
  const content = `
    <h2>대중교통(버스) 정류장 위치도</h2>
    ${renderStaticMap(report)}
    <h2>대중교통(버스) 정류장 목록</h2>
    ${renderStopList(report.stops)}
    <h2>대중교통(버스) 정류장별 운행현황</h2>
    ${renderStopRouteTable(report.stopRouteTable)}
    <h2>대중교통(버스) 노선별 운행현황</h2>
    ${renderRouteOperationTable(report.routeOperationTable)}
  `;

  if (!fullDocument) return content;
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Malgun Gothic, Arial, sans-serif; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
          th, td { border: 1px solid #111; padding: 4px 6px; font-size: 10pt; }
          th { background: #e8e8e8; }
          svg { max-width: 100%; height: auto; }
        </style>
      </head>
      <body>${content}</body>
    </html>
  `;
}

function buildPlainText(report) {
  const lines = [];
  lines.push("대중교통(버스) 정류장 목록");
  for (const stop of report.stops) {
    lines.push([
      stop.pointNo,
      stop.name,
      stop.arsNo || "-",
      stop.nodeId,
      stop.distance,
      formatCad(getCadCoord(stop).x),
      formatCad(getCadCoord(stop).y)
    ].join("\t"));
  }
  lines.push("");
  lines.push("대중교통(버스) 정류장별 운행현황");
  for (const row of groupStopRoutes(report.stopRouteTable)) {
    lines.push(`${row.pointNos.map(circled).join(", ")}\t${row.stopNames.join(", ")}\t${row.routes.join(", ")}`);
  }
  lines.push("");
  lines.push("대중교통(버스) 노선별 운행현황");
  for (const route of report.routeOperationTable) {
    lines.push([
      route.routeGroup,
      route.routeNo,
      route.startNodeName,
      route.endNodeName,
      route.firstTime,
      route.lastTime,
      route.peakInterval,
      route.normalInterval,
      route.holidayInterval
    ].join("\t"));
  }
  return lines.join("\n");
}

function groupStopRoutes(rows) {
  const groups = new Map();
  for (const row of rows) {
    const routes = [...row.routes].sort((a, b) => a.localeCompare(b, "ko-KR", { numeric: true }));
    const key = routes.join("|") || "__empty__";
    if (!groups.has(key)) {
      groups.set(key, {
        pointNos: [],
        stopNames: [],
        routes
      });
    }
    const group = groups.get(key);
    group.pointNos.push(row.pointNo);
    group.stopNames.push(row.stopName);
  }

  return Array.from(groups.values()).sort((a, b) => a.pointNos[0] - b.pointNos[0]);
}

function circled(value) {
  const number = Number(value);
  if (number >= 1 && number <= CIRCLED.length) return CIRCLED[number - 1];
  return String(value);
}

function formatCoord(value) {
  return Number(value).toFixed(14).replace(/0+$/u, "").replace(/\.$/u, "");
}

function getCadCoord(point) {
  return {
    x: Number(point?.cad?.x),
    y: Number(point?.cad?.y)
  };
}

function formatCad(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function formatCadPair(cad) {
  const point = getCadCoord({ cad });
  return `X ${formatCad(point.x)}, Y ${formatCad(point.y)}`;
}

function getCadSystemLabel(report) {
  return report.coordinateSystem?.output?.epsg || "EPSG:5187";
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
