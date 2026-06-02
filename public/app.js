const BIMS_ENDPOINTS = {
  stops: "busStopList",
  routes: "busInfo",
  routeStops: "busInfoByRouteId",
};

const SAMPLE = {
  stops: [
    { bstopid: "505780000", bstopnm: "부산시청", arsno: "13708", gpsx: "129.076914", gpsy: "35.179938", stoptype: "일반" },
    { bstopid: "505780001", bstopnm: "시청역", arsno: "13709", gpsx: "129.078200", gpsy: "35.180350", stoptype: "일반" },
    { bstopid: "505780002", bstopnm: "연산교차로", arsno: "13710", gpsx: "129.080600", gpsy: "35.181100", stoptype: "일반" },
    { bstopid: "505780003", bstopnm: "연제구청", arsno: "13711", gpsx: "129.074700", gpsy: "35.178700", stoptype: "일반" },
    { bstopid: "505780004", bstopnm: "거제시장", arsno: "13712", gpsx: "129.073300", gpsy: "35.178100", stoptype: "마을" },
  ],
  routes: [
    { lineid: "5200003300", buslinenum: "33", bustype: "일반버스", startpoint: "초읍", endpoint: "만덕", firsttime: "05:00", endtime: "22:40", headwaypeak: "8", headwaynorm: "10", headwayholi: "12" },
    { lineid: "5200004400", buslinenum: "44", bustype: "일반버스", startpoint: "반여동", endpoint: "당감동", firsttime: "04:50", endtime: "22:28", headwaypeak: "5", headwaynorm: "9", headwayholi: "9" },
    { lineid: "5200010300", buslinenum: "103", bustype: "일반버스", startpoint: "연제공용차고지", endpoint: "장림", firsttime: "05:00", endtime: "22:00", headwaypeak: "8", headwaynorm: "12", headwayholi: "14" },
    { lineid: "5200017900", buslinenum: "179", bustype: "일반버스", startpoint: "회동동", endpoint: "국제백양", firsttime: "04:55", endtime: "23:05", headwaypeak: "5", headwaynorm: "7", headwayholi: "8" },
    { lineid: "5200050600", buslinenum: "506", bustype: "심야버스", startpoint: "반여4동", endpoint: "부산시민공원", firsttime: "05:00", endtime: "22:40", headwaypeak: "10", headwaynorm: "14", headwayholi: "16" },
    { lineid: "5290000100", buslinenum: "부산진구1", bustype: "마을버스", startpoint: "부산시청", endpoint: "서면", firsttime: "06:00", endtime: "23:00", headwaypeak: "8", headwaynorm: "8", headwayholi: "10" },
  ],
  routeStops: {
    "5200003300": ["505780000", "505780001", "505780002"],
    "5200004400": ["505780000", "505780003"],
    "5200010300": ["505780001", "505780002", "505780003"],
    "5200017900": ["505780000", "505780001"],
    "5200050600": ["505780002"],
    "5290000100": ["505780004"],
  },
};

const state = {
  stops: [],
  routes: [],
  selectedStops: [],
  routeStopMap: new Map(),
  stopRoutes: new Map(),
  routeById: new Map(),
  logs: [],
  report: null,
  serverKeyAvailable: false,
  accessCodeRequired: false,
  authenticated: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function init() {
  const savedKey = localStorage.getItem("bimsServiceKey");
  const savedAccessCode = localStorage.getItem("bimsAccessCode");
  if (savedKey) {
    $("#serviceKey").value = savedKey;
    $("#rememberKey").checked = true;
  }
  if (savedAccessCode) $("#accessCode").value = savedAccessCode;

  $("#runBims").addEventListener("click", runBims);
  $("#runSample").addEventListener("click", runSample);
  $("#copyReport").addEventListener("click", copyReport);
  $("#downloadCsv").addEventListener("click", () => downloadReportCsv("bims_route_report.csv"));
  $("#downloadCad").addEventListener("click", () => downloadCadCsv("bims_stop_points_for_cad.csv"));
  $("#accessForm").addEventListener("submit", handleAccessSubmit);
  $("#rememberKey").addEventListener("change", rememberKey);
  $("#serviceKey").addEventListener("input", rememberKey);
  $("#accessCode").addEventListener("input", () => {
    localStorage.setItem("bimsAccessCode", $("#accessCode").value.trim());
  });

  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  });

  renderEmpty();
  loadServerConfig();
}

async function loadServerConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const config = await response.json();
    state.serverKeyAvailable = Boolean(config.serverKeyAvailable);
    state.accessCodeRequired = Boolean(config.accessCodeRequired);
    state.authenticated = Boolean(config.authenticated);

    const notice = $("#serverKeyNotice");
    const serviceKeyInput = $("#serviceKey");
    const accessCodeLabel = $("#accessCodeLabel");

    if (state.serverKeyAvailable) {
      notice.hidden = false;
      notice.textContent = "서버에 BIMS 서비스키가 설정되어 있어 사용자별 키 입력 없이 조회할 수 있습니다.";
      serviceKeyInput.placeholder = "서버 키 사용 중";
    } else {
      notice.hidden = false;
      notice.textContent = "서버 키가 없어 사용자별 공공데이터포털 서비스키 입력이 필요합니다.";
    }

    accessCodeLabel.hidden = !state.accessCodeRequired;
    updateAccessGate();
  } catch (error) {
    log(`서버 설정 확인 실패: ${error.message}`);
  }
}

function updateAccessGate() {
  const accessCode = $("#accessCode").value.trim();
  const locked = state.accessCodeRequired && !accessCode && !state.authenticated;
  document.body.classList.toggle("is-locked", locked);
  $("#accessGate").hidden = !locked;
}

async function handleAccessSubmit(event) {
  event.preventDefault();
  const code = $("#gateAccessCode").value.trim();
  if (!code) return;

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode: code }),
    });
    if (!response.ok) throw new Error("접근 코드가 올바르지 않습니다.");

    $("#accessCode").value = code;
    localStorage.setItem("bimsAccessCode", code);
    state.authenticated = true;
    $("#accessError").hidden = true;
    updateAccessGate();
  } catch (error) {
    $("#accessError").textContent = error.message;
    $("#accessError").hidden = false;
  }
}

function rememberKey() {
  if ($("#rememberKey").checked) {
    localStorage.setItem("bimsServiceKey", $("#serviceKey").value.trim());
  } else {
    localStorage.removeItem("bimsServiceKey");
  }
}

function activateTab(id) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === id));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
}

function setBusy(isBusy) {
  $("#runBims").disabled = isBusy;
  $("#runSample").disabled = isBusy;
}

function setStatus(label, detail, progress = null) {
  $("#statusLabel").textContent = label;
  $("#statusDetail").textContent = detail;
  if (progress !== null) $("#progress").value = progress;
}

function log(message) {
  const stamp = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  state.logs.push(`[${stamp}] ${message}`);
  $("#logOutput").textContent = state.logs.join("\n");
}

function getConfig() {
  const siteName = $("#siteName").value.trim() || "사업지";
  const centerLat = Number($("#centerLat").value);
  const centerLng = Number($("#centerLng").value);
  const radius = Number($("#radius").value);
  const serviceKey = $("#serviceKey").value.trim();

  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    throw new Error("사업지 중심 위도/경도를 입력하세요.");
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error("반경을 올바르게 입력하세요.");
  }

  return { siteName, centerLat, centerLng, radius, serviceKey };
}

async function runSample() {
  try {
    setBusy(true);
    state.logs = [];
    const config = {
      siteName: $("#siteName").value.trim() || "사업지",
      centerLat: Number($("#centerLat").value) || 35.179938,
      centerLng: Number($("#centerLng").value) || 129.076914,
      radius: Number($("#radius").value) || 500,
    };
    $("#centerLat").value = config.centerLat;
    $("#centerLng").value = config.centerLng;
    $("#radius").value = config.radius;

    setStatus("샘플 실행 중", "샘플 BIMS 구조 데이터로 화면을 생성합니다.", 10);
    log("샘플 정류소·노선 데이터를 불러왔습니다.");
    await pause(120);

    state.stops = SAMPLE.stops;
    state.routes = SAMPLE.routes;
    state.routeById = new Map(SAMPLE.routes.map((route) => [route.lineid, route]));
    state.routeStopMap = new Map(Object.entries(SAMPLE.routeStops));
    buildReport(config);
    setStatus("샘플 완료", "실제 BIMS 키를 넣으면 같은 형식으로 조회됩니다.", 100);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runBims() {
  try {
    setBusy(true);
    state.logs = [];
    const config = getConfig();
    if (!config.serviceKey && !state.serverKeyAvailable) throw new Error("공공데이터포털 서비스키를 입력하세요.");
    if (state.accessCodeRequired && !$("#accessCode").value.trim()) throw new Error("접근 코드를 입력하세요.");
    rememberKey();

    setStatus("BIMS 조회 중", "정류소 목록을 불러옵니다.", 5);
    state.stops = await fetchPagedBims(BIMS_ENDPOINTS.stops, config.serviceKey, {}, "정류소");
    if (!state.stops.length) throw new Error("BIMS 정류소 목록이 비어 있습니다. 서비스키와 API 승인 상태를 확인하세요.");

    setStatus("BIMS 조회 중", "반경 안 정류장을 선별합니다.", 20);
    const selected = selectStopsInRadius(state.stops, config);
    if (!selected.length) throw new Error("지정 반경 안에 BIMS 정류소가 없습니다. 좌표와 반경을 확인하세요.");
    state.selectedStops = selected;
    log(`반경 ${config.radius}m 안 정류소 ${selected.length}개를 찾았습니다.`);

    setStatus("BIMS 조회 중", "노선 운행정보를 불러옵니다.", 30);
    state.routes = await fetchPagedBims(BIMS_ENDPOINTS.routes, config.serviceKey, {}, "노선");
    if (!state.routes.length) throw new Error("BIMS 노선정보가 비어 있습니다.");
    state.routeById = new Map(state.routes.map((route) => [norm(route.lineid), route]).filter(([id]) => id));

    setStatus("BIMS 조회 중", "노선별 경유 정류소를 대조합니다.", 45);
    await loadRouteStopMap(config.serviceKey, state.routes, selected);

    buildReport(config);
    setStatus("완료", `${config.siteName} 반경 ${config.radius}m 기준 현황표를 생성했습니다.`, 100);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function fetchPagedBims(endpoint, serviceKey, params, label) {
  const rows = [];
  let pageNo = 1;
  let totalCount = null;
  const numOfRows = 1000;

  while (pageNo <= 80) {
    const query = new URLSearchParams({
      endpoint,
      serviceKey,
      pageNo: String(pageNo),
      numOfRows: String(numOfRows),
      ...params,
    });

    const xml = await fetchText(`/api/bims?${query.toString()}`);
    const parsed = parseBimsXml(xml);
    if (parsed.error) throw new Error(`${label} 조회 실패: ${parsed.error}`);
    totalCount = parsed.totalCount ?? totalCount;
    rows.push(...parsed.items);
    log(`${label} ${pageNo}페이지: ${parsed.items.length}건`);

    if (totalCount !== null && rows.length >= totalCount) break;
    if (parsed.items.length < numOfRows) break;
    pageNo += 1;
  }

  log(`${label} 전체 ${rows.length}건 확보`);
  return uniqueBy(rows, (item) => norm(item.bstopid) || norm(item.lineid) || JSON.stringify(item));
}

async function loadRouteStopMap(serviceKey, routes, selectedStops) {
  const selectedIds = new Set(selectedStops.map((stop) => norm(stop.bstopid)));
  const routeStopMap = new Map();
  const candidateRoutes = routes.filter((route) => norm(route.lineid));
  const total = candidateRoutes.length;
  let matchedRoutes = 0;

  for (let i = 0; i < candidateRoutes.length; i += 1) {
    const route = candidateRoutes[i];
    const lineid = norm(route.lineid);
    const query = new URLSearchParams({
      endpoint: BIMS_ENDPOINTS.routeStops,
      serviceKey,
      lineid,
    });

    const xml = await fetchText(`/api/bims?${query.toString()}`);
    const parsed = parseBimsXml(xml);
    if (parsed.error) {
      log(`${displayRoute(route)} 경유 정류소 조회 실패: ${parsed.error}`);
      continue;
    }

    const stopIds = parsed.items
      .map((item) => norm(item.bstopid || item.nodeid))
      .filter(Boolean);
    routeStopMap.set(lineid, stopIds);

    if (stopIds.some((id) => selectedIds.has(id))) matchedRoutes += 1;

    if (i % 10 === 0 || i === total - 1) {
      const progress = 45 + Math.round(((i + 1) / Math.max(total, 1)) * 45);
      setStatus("BIMS 조회 중", `노선별 경유 정류소 대조 ${i + 1}/${total}`, progress);
      await pause(0);
    }
  }

  state.routeStopMap = routeStopMap;
  log(`사업지 반경 정류소와 맞닿는 노선 ${matchedRoutes}개를 확인했습니다.`);
}

async function fetchText(url) {
  const headers = {};
  const accessCode = $("#accessCode")?.value?.trim();
  if (accessCode) headers["x-access-code"] = accessCode;
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    try {
      const payload = JSON.parse(text);
      throw new Error(payload.error || response.statusText);
    } catch (error) {
      if (error.message && error.message !== "Unexpected token '<', \"<OpenAPI_S\"... is not valid JSON") {
        throw error;
      }
      throw new Error(response.statusText);
    }
  }
  return text;
}

function parseBimsXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    return { items: [], totalCount: 0, error: "XML 파싱 오류" };
  }

  const resultCode = getText(doc, "resultCode");
  const resultMsg = getText(doc, "resultMsg") || getText(doc, "returnAuthMsg");
  if (resultCode && resultCode !== "00") {
    return { items: [], totalCount: 0, error: `${resultCode} ${resultMsg}`.trim() };
  }

  const items = [...doc.querySelectorAll("item")].map((item) => {
    const obj = {};
    [...item.children].forEach((child) => {
      obj[child.tagName.toLowerCase()] = child.textContent.trim();
    });
    return normalizeKeys(obj);
  });

  return {
    items,
    totalCount: Number(getText(doc, "totalCount")) || null,
    error: null,
  };
}

function normalizeKeys(item) {
  const aliases = {
    bstopid: ["bstopid", "bstopId", "bstop_id"],
    bstopnm: ["bstopnm", "bstopNm", "nodenm", "nodeNm"],
    arsno: ["arsno", "bstoparsno", "bstopArsno"],
    gpsx: ["gpsx", "gpsX", "x"],
    gpsy: ["gpsy", "gpsY", "y"],
    lineid: ["lineid", "lineId"],
    buslinenum: ["buslinenum", "busLineNum", "lineno"],
    bustype: ["bustype", "busType"],
    startpoint: ["startpoint", "startPoint"],
    endpoint: ["endpoint", "endPoint"],
    firsttime: ["firsttime", "firstTime"],
    endtime: ["endtime", "endTime"],
    headwaypeak: ["headwaypeak", "headwayPeak"],
    headwaynorm: ["headwaynorm", "headwayNorm", "headway"],
    headwayholi: ["headwayholi", "headwayHoli"],
  };

  const lowered = {};
  Object.entries(item).forEach(([key, value]) => {
    lowered[key.toLowerCase()] = value;
  });

  for (const [target, keys] of Object.entries(aliases)) {
    if (item[target]) continue;
    for (const key of keys) {
      const value = lowered[key.toLowerCase()];
      if (value !== undefined) {
        item[target] = value;
        break;
      }
    }
  }

  return item;
}

function getText(doc, selector) {
  return doc.querySelector(selector)?.textContent?.trim() || "";
}

function selectStopsInRadius(stops, config) {
  return stops
    .map((stop) => {
      const lat = Number(stop.gpsy);
      const lng = Number(stop.gpsx);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        ...stop,
        lat,
        lng,
        distance: Math.round(distanceMeters(config.centerLat, config.centerLng, lat, lng)),
      };
    })
    .filter(Boolean)
    .filter((stop) => stop.distance <= config.radius)
    .sort((a, b) => a.distance - b.distance || displayStop(a).localeCompare(displayStop(b), "ko"));
}

function buildReport(config) {
  const selectedStops = state.selectedStops.length
    ? state.selectedStops
    : selectStopsInRadius(state.stops, config);
  state.selectedStops = selectedStops;

  const stopIds = new Set(selectedStops.map((stop) => norm(stop.bstopid)));
  const stopRoutes = new Map(selectedStops.map((stop) => [norm(stop.bstopid), []]));
  const selectedRouteIds = new Set();

  for (const [lineid, routeStopIds] of state.routeStopMap.entries()) {
    const hasStop = routeStopIds.some((stopId) => stopIds.has(norm(stopId)));
    if (!hasStop) continue;
    selectedRouteIds.add(lineid);
    routeStopIds.forEach((stopId) => {
      const id = norm(stopId);
      if (stopRoutes.has(id)) stopRoutes.get(id).push(lineid);
    });
  }

  for (const [stopId, routeIds] of stopRoutes.entries()) {
    routeIds.sort((a, b) => routeSortValue(state.routeById.get(a)).localeCompare(routeSortValue(state.routeById.get(b)), "ko", { numeric: true }));
    stopRoutes.set(stopId, uniqueBy(routeIds, (id) => id));
  }

  const selectedRoutes = [...selectedRouteIds]
    .map((lineid) => state.routeById.get(lineid))
    .filter(Boolean)
    .sort((a, b) => routeSortValue(a).localeCompare(routeSortValue(b), "ko", { numeric: true }));

  state.stopRoutes = stopRoutes;
  state.report = { config, stops: selectedStops, routes: selectedRoutes, stopRoutes };

  renderReport(state.report);
}

function renderReport(report) {
  const counts = countRouteTypes(report.routes);
  $("#stopCount").textContent = report.stops.length;
  $("#routeCount").textContent = report.routes.length;
  $("#normalCount").textContent = counts.normal;
  $("#nightCount").textContent = counts.night;
  $("#villageCount").textContent = counts.village;
  $("#stopBasis").textContent = `${report.config.siteName} 반경 ${report.config.radius}m, BIMS 정류소ID 기준`;
  $("#routeBasis").textContent = `BIMS 노선정보 기준, 고유 노선 ${report.routes.length}개`;

  renderStopTable(report);
  renderGroupedStopTable(report);
  renderRouteTable(report);
  renderCadTable(report);
}

function renderStopTable(report) {
  const tbody = $("#stopTable tbody");
  tbody.innerHTML = "";
  report.stops.forEach((stop, index) => {
    const routeText = routesForStop(report, stop).map(displayRoute).join(", ");
    tbody.append(row([
      badge(index + 1),
      cell(displayStop(stop), "left"),
      text(stop.arsno || "-"),
      text(stop.distance),
      cell(routeText || "-", "route-list"),
    ]));
  });
  if (!report.stops.length) renderEmptyRows();
}

function renderGroupedStopTable(report) {
  const tbody = $("#groupedStopTable tbody");
  tbody.innerHTML = "";
  const groups = new Map();

  report.stops.forEach((stop, index) => {
    const routeText = routesForStop(report, stop).map(displayRoute).join(", ") || "-";
    if (!groups.has(routeText)) groups.set(routeText, []);
    groups.get(routeText).push(numberSymbol(index + 1));
  });

  for (const [routeText, points] of groups.entries()) {
    tbody.append(row([
      cell(points.join(", "), "left"),
      cell(routeText, "route-list"),
    ]));
  }
}

function renderRouteTable(report) {
  const tbody = $("#routeTable tbody");
  tbody.innerHTML = "";
  report.routes.forEach((route) => {
    tbody.append(row([
      text(routeGroup(route)),
      text(displayRoute(route)),
      text(route.startpoint || "-"),
      text(route.endpoint || "-"),
      text(formatTime(route.firsttime)),
      text(formatTime(route.endtime)),
      text(formatHeadway(route.headwaypeak)),
      text(formatHeadway(route.headwaynorm)),
      text(formatHeadway(route.headwayholi)),
    ]));
  });
}

function renderCadTable(report) {
  const tbody = $("#cadTable tbody");
  tbody.innerHTML = "";
  report.stops.forEach((stop, index) => {
    tbody.append(row([
      text(index + 1),
      text(displayStop(stop)),
      text(stop.arsno || "-"),
      text(stop.lat.toFixed(7)),
      text(stop.lng.toFixed(7)),
      text(stop.distance),
    ]));
  });
}

function renderEmpty() {
  ["#stopTable tbody", "#groupedStopTable tbody", "#routeTable tbody", "#cadTable tbody"].forEach((selector) => {
    const tbody = $(selector);
    tbody.innerHTML = "";
    const table = tbody.closest("table");
    const colspan = table.querySelectorAll("thead th").length;
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colspan;
    td.className = "empty-cell";
    td.textContent = "아직 생성된 결과가 없습니다.";
    tr.append(td);
    tbody.append(tr);
  });
}

function renderEmptyRows() {
  renderEmpty();
}

function routesForStop(report, stop) {
  return (report.stopRoutes.get(norm(stop.bstopid)) || [])
    .map((lineid) => state.routeById.get(lineid))
    .filter(Boolean);
}

function countRouteTypes(routes) {
  const result = { normal: 0, night: 0, village: 0 };
  routes.forEach((route) => {
    const group = routeGroup(route);
    if (group === "마을") result.village += 1;
    else if (group === "심야") result.night += 1;
    else result.normal += 1;
  });
  return result;
}

function routeGroup(route) {
  const textValue = `${route.bustype || ""} ${route.buslinenum || ""}`;
  if (textValue.includes("마을") || /구\d/.test(route.buslinenum || "")) return "마을";
  if (textValue.includes("심야") || textValue.includes("(심야)")) return "심야";
  return "일반";
}

function displayRoute(route) {
  if (!route) return "-";
  return route.buslinenum || route.lineno || route.lineid || "-";
}

function displayStop(stop) {
  return stop.bstopnm || stop.nodenm || stop.nodeNm || "-";
}

function routeSortValue(route) {
  if (!route) return "";
  const name = displayRoute(route);
  return name.replace(/^부산/, "zz부산");
}

function formatTime(value) {
  if (!value) return "-";
  const clean = String(value).trim();
  if (/^\d{4}$/.test(clean)) return `${clean.slice(0, 2)}:${clean.slice(2)}`;
  return clean;
}

function formatHeadway(value) {
  if (!value) return "-";
  const clean = String(value).trim();
  return clean.endsWith("분") ? clean.replace("분", "") : clean;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  const result = [];
  items.forEach((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function norm(value) {
  return String(value ?? "").trim();
}

function row(cells) {
  const tr = document.createElement("tr");
  cells.forEach((item) => tr.append(item instanceof Node ? item : text(item)));
  return tr;
}

function text(value) {
  const td = document.createElement("td");
  td.textContent = value ?? "";
  return td;
}

function cell(value, className) {
  const td = text(value);
  td.className = className;
  return td;
}

function badge(index) {
  const td = document.createElement("td");
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = numberSymbol(index);
  td.append(span);
  return td;
}

function numberSymbol(index) {
  const symbols = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
  return symbols[index - 1] || String(index);
}

async function copyReport() {
  if (!state.report) {
    showError(new Error("복사할 결과가 없습니다."));
    return;
  }

  const html = buildReportHtml(state.report);
  const plain = buildPlainReport(state.report);
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    setStatus("복사 완료", "보고서 표를 클립보드에 복사했습니다.", 100);
  } catch (error) {
    showError(new Error(`클립보드 복사 실패: ${error.message}`));
  }
}

function buildReportHtml(report) {
  const grouped = groupStops(report);
  const routeRows = report.routes.map((route) => `
    <tr>
      <td>${escapeHtml(routeGroup(route))}</td>
      <td>${escapeHtml(displayRoute(route))}</td>
      <td>${escapeHtml(route.startpoint || "-")}</td>
      <td>${escapeHtml(route.endpoint || "-")}</td>
      <td>${escapeHtml(formatTime(route.firsttime))}</td>
      <td>${escapeHtml(formatTime(route.endtime))}</td>
      <td>${escapeHtml(formatHeadway(route.headwaypeak))}</td>
      <td>${escapeHtml(formatHeadway(route.headwaynorm))}</td>
      <td>${escapeHtml(formatHeadway(route.headwayholi))}</td>
    </tr>`).join("");

  const stopRows = grouped.map((group) => `
    <tr>
      <td>${escapeHtml(group.points.join(", "))}</td>
      <td>${escapeHtml(group.routes)}</td>
    </tr>`).join("");

  return `
    <h3>${escapeHtml(report.config.siteName)} 주변지역 대중교통 운행 현황</h3>
    <p>${escapeHtml(report.config.siteName)} 주변의 대중교통 현황은 일반버스 ${countRouteTypes(report.routes).normal}개, 심야버스 ${countRouteTypes(report.routes).night}개, 마을버스 ${countRouteTypes(report.routes).village}개 등 총 ${report.routes.length}개의 버스노선이 운행되고 있음.</p>
    <table border="1" cellspacing="0" cellpadding="4">
      <thead><tr><th>조사지점</th><th>운행노선</th></tr></thead>
      <tbody>${stopRows}</tbody>
    </table>
    <br>
    <table border="1" cellspacing="0" cellpadding="4">
      <thead><tr><th>구분</th><th>노선번호</th><th>기점</th><th>종점</th><th>첫차</th><th>막차</th><th>출퇴근</th><th>평일</th><th>공휴일</th></tr></thead>
      <tbody>${routeRows}</tbody>
    </table>
    <p>자료: 부산시 버스정보시스템(BIMS)</p>
  `;
}

function buildPlainReport(report) {
  const grouped = groupStops(report)
    .map((group) => `${group.points.join(", ")}\t${group.routes}`)
    .join("\n");
  const routes = report.routes
    .map((route) => [
      routeGroup(route),
      displayRoute(route),
      route.startpoint || "-",
      route.endpoint || "-",
      formatTime(route.firsttime),
      formatTime(route.endtime),
      formatHeadway(route.headwaypeak),
      formatHeadway(route.headwaynorm),
      formatHeadway(route.headwayholi),
    ].join("\t"))
    .join("\n");
  return `조사지점\t운행노선\n${grouped}\n\n구분\t노선번호\t기점\t종점\t첫차\t막차\t출퇴근\t평일\t공휴일\n${routes}\n자료: 부산시 버스정보시스템(BIMS)`;
}

function groupStops(report) {
  const groups = new Map();
  report.stops.forEach((stop, index) => {
    const routeText = routesForStop(report, stop).map(displayRoute).join(", ") || "-";
    if (!groups.has(routeText)) groups.set(routeText, []);
    groups.get(routeText).push(numberSymbol(index + 1));
  });
  return [...groups.entries()].map(([routes, points]) => ({ routes, points }));
}

function downloadReportCsv(filename) {
  if (!state.report) {
    showError(new Error("저장할 결과가 없습니다."));
    return;
  }
  const rows = [
    ["구분", "노선번호", "기점", "종점", "첫차", "막차", "출퇴근", "평일", "공휴일"],
    ...state.report.routes.map((route) => [
      routeGroup(route),
      displayRoute(route),
      route.startpoint || "-",
      route.endpoint || "-",
      formatTime(route.firsttime),
      formatTime(route.endtime),
      formatHeadway(route.headwaypeak),
      formatHeadway(route.headwaynorm),
      formatHeadway(route.headwayholi),
    ]),
  ];
  downloadCsv(filename, rows);
}

function downloadCadCsv(filename) {
  if (!state.report) {
    showError(new Error("저장할 결과가 없습니다."));
    return;
  }
  const rows = [
    ["번호", "정류소명", "정류소번호", "위도", "경도", "거리_m", "운행노선"],
    ...state.report.stops.map((stop, index) => [
      index + 1,
      displayStop(stop),
      stop.arsno || "-",
      stop.lat.toFixed(7),
      stop.lng.toFixed(7),
      stop.distance,
      routesForStop(state.report, stop).map(displayRoute).join(", "),
    ]),
  ];
  downloadCsv(filename, rows);
}

function downloadCsv(filename, rows) {
  const csv = rows.map((rowValues) => rowValues.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const textValue = String(value ?? "");
  if (/[",\r\n]/.test(textValue)) return `"${textValue.replaceAll('"', '""')}"`;
  return textValue;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showError(error) {
  setStatus("오류", error.message, 0);
  log(`오류: ${error.message}`);
  $("#statusDetail").classList.add("error");
  setTimeout(() => $("#statusDetail").classList.remove("error"), 1800);
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

init();
