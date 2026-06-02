import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const configPath = path.join(__dirname, "config.local.json");
const PORT = Number(process.env.PORT || 5178);
const BUSAN_BIMS_BASE = "http://apis.data.go.kr/6260000/BusanBIMS";
const CAD_COORDINATE_SYSTEM = {
  name: "Korea 2000 / East Belt 2010",
  epsg: "EPSG:5187",
  description: "CAD X=Easting, CAD Y=Northing"
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const allStopsCache = { value: null };
const allRoutesCache = { value: null };
const routeStopIndexCache = { value: null };
const busanRouteCache = new Map();
const stopArrivalCache = new Map();

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatTime(value) {
  const raw = String(value || "").replace(/\D/g, "");
  if (!raw) return "";
  const padded = raw.padStart(4, "0").slice(-4);
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

function stripRouteType(value = "") {
  return String(value).replace(/\s+/g, "").replace(/버스$/u, "") || "일반";
}

function normalizeName(value = "") {
  return String(value).replace(/\s+/g, "").trim();
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const earth = 6371000;
  const toRad = (degree) => (degree * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

function meridionalArc(phi, e2, a) {
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  return a * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi)
  );
}

function projectWgs84ToCad(lat, lng) {
  const toRad = (degree) => (degree * Math.PI) / 180;
  const a = 6378137;
  const inverseFlattening = 298.257222101;
  const f = 1 / inverseFlattening;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const lat0 = toRad(38);
  const lon0 = toRad(129);
  const k0 = 1;
  const falseEasting = 200000;
  const falseNorthing = 600000;

  const phi = toRad(lat);
  const lambda = toRad(lng);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const n = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const t = tanPhi * tanPhi;
  const c = ep2 * cosPhi * cosPhi;
  const A = (lambda - lon0) * cosPhi;
  const m = meridionalArc(phi, e2, a);
  const m0 = meridionalArc(lat0, e2, a);

  const easting = falseEasting + k0 * n * (
    A
    + (1 - t + c) * A ** 3 / 6
    + (5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * A ** 5 / 120
  );
  const northing = falseNorthing + k0 * (
    m - m0
    + n * tanPhi * (
      A ** 2 / 2
      + (5 - t + 9 * c + 4 * c ** 2) * A ** 4 / 24
      + (61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * A ** 6 / 720
    )
  );

  return {
    x: Math.round(easting * 1000) / 1000,
    y: Math.round(northing * 1000) / 1000
  };
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function routeSort(a, b) {
  const ax = String(a.routeNo || a.lineno || "");
  const bx = String(b.routeNo || b.lineno || "");
  const an = Number(ax.match(/^\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
  const bn = Number(bx.match(/^\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
  if (an !== bn) return an - bn;
  return ax.localeCompare(bx, "ko-KR", { numeric: true });
}

function makeCacheKey(name, params) {
  return `${name}:${new URLSearchParams(params).toString()}`;
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function xmlDecode(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function readXmlTag(xml, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? xmlDecode(match[1]) : "";
}

function parseSimpleXmlItems(xml) {
  const items = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    const itemXml = match[1];
    const item = {};
    for (const field of itemXml.matchAll(/<([^/>\s]+)>([\s\S]*?)<\/\1>/g)) {
      item[field[1].toLowerCase()] = xmlDecode(field[2]);
    }
    items.push(item);
  }

  return {
    resultCode: readXmlTag(xml, "resultCode"),
    resultMsg: readXmlTag(xml, "resultMsg"),
    totalCount: toNumber(readXmlTag(xml, "totalCount"), items.length),
    items
  };
}

async function loadApiKey() {
  const envKey = process.env.DATA_GO_KR_API_KEY || process.env.BUSAN_BIMS_API_KEY;
  if (envKey) return String(envKey).trim();

  const config = await loadLocalConfig();
  return String(config.apiKey || config.serviceKey || config.dataGoKrApiKey || "").trim();
}

async function loadLocalConfig() {
  try {
    const text = (await readFile(configPath, "utf8")).replace(/^\uFEFF/u, "");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function buildBusanUrl(operation, params, apiKey) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && String(value) !== "") {
      query.set(key, String(value));
    }
  }

  const keyParam = apiKey.includes("%") ? apiKey : encodeURIComponent(apiKey);
  const queryText = query.toString();
  return `${BUSAN_BIMS_BASE}/${operation}?${queryText ? `${queryText}&` : ""}serviceKey=${keyParam}`;
}

async function fetchBusanItems(operation, params, apiKey) {
  const url = buildBusanUrl(operation, params, apiKey);
  const response = await fetch(url, {
    headers: { Accept: "application/xml,text/xml,*/*;q=0.8" }
  });
  const text = await response.text();

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("부산BIMS API 권한이 거부되었습니다. 공공데이터포털에서 '부산광역시_부산버스정보시스템' 활용신청이 완료됐는지 확인해 주세요.");
    }
    if (response.status === 404) {
      throw new Error(`부산BIMS API 주소를 찾을 수 없습니다: ${operation}`);
    }
    throw new Error(`API HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (text.includes("SERVICE_KEY_IS_NOT_REGISTERED_ERROR")) {
    throw new Error("공공데이터포털 서비스키가 등록되지 않았거나 잘못되었습니다.");
  }

  const parsed = parseSimpleXmlItems(text);
  if (parsed.resultCode && parsed.resultCode !== "00") {
    throw new Error(`${parsed.resultMsg || "부산BIMS API 오류"} (${parsed.resultCode})`);
  }
  return parsed;
}

async function fetchPagedBusanItems(operation, params, apiKey) {
  const numOfRows = 1000;
  const allItems = [];

  for (let pageNo = 1; pageNo <= 50; pageNo += 1) {
    const page = await fetchBusanItems(operation, { ...params, pageNo, numOfRows }, apiKey);
    allItems.push(...page.items);
    if (!page.items.length) break;
    if (page.totalCount && allItems.length >= page.totalCount) break;
    if (page.items.length < numOfRows) break;
  }

  return allItems;
}

async function fetchAllStops(apiKey) {
  if (allStopsCache.value) return allStopsCache.value;

  const rawStops = await fetchPagedBusanItems("busStopList", {}, apiKey);
  const stops = rawStops
    .map((raw) => ({
      nodeId: String(raw.bstopid || ""),
      arsNo: String(raw.arsno || ""),
      name: String(raw.bstopnm || ""),
      lat: toNumber(raw.gpsy, NaN),
      lng: toNumber(raw.gpsx, NaN),
      stopType: String(raw.stoptype || "")
    }))
    .filter((stop) => stop.nodeId && stop.name && Number.isFinite(stop.lat) && Number.isFinite(stop.lng));

  if (!stops.length) {
    throw new Error("부산BIMS 정류소 목록을 가져오지 못했습니다. busStopList 활용 권한 또는 서비스 상태를 확인해 주세요.");
  }

  allStopsCache.value = dedupeBy(stops, (stop) => stop.nodeId);
  return allStopsCache.value;
}

async function fetchNearbyStops(apiKey, lat, lng, radius) {
  const allStops = await fetchAllStops(apiKey);
  return allStops
    .map((stop) => ({
      ...stop,
      distance: Math.round(distanceMeters(lat, lng, stop.lat, stop.lng))
    }))
    .filter((stop) => stop.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .map((stop, index) => ({ ...stop, pointNo: index + 1 }));
}

function normalizeRouteInfo(raw, fallback = {}) {
  const routeNo = String(raw.buslinenum || raw.lineno || raw.routeno || fallback.routeNo || "").trim();
  const routeId = String(raw.lineid || raw.routeid || fallback.routeId || "").trim();
  const routeType = String(raw.bustype || raw.routetp || fallback.routeType || "").trim();

  return {
    source: "부산BIMS",
    routeId,
    routeNo,
    routeType,
    routeGroup: stripRouteType(routeType),
    startNodeName: String(raw.startpoint || raw.startnodenm || fallback.startNodeName || "").trim(),
    endNodeName: String(raw.endpoint || raw.endnodenm || fallback.endNodeName || "").trim(),
    firstTime: formatTime(raw.firsttime || raw.startvehicletime),
    lastTime: formatTime(raw.endtime || raw.endvehicletime),
    peakInterval: String(raw.headwaypeak || "").trim(),
    normalInterval: String(raw.headwaynorm || raw.headway || raw.intervaltime || "").trim(),
    holidayInterval: String(raw.headwayholi || raw.intervalsuntime || "").trim()
  };
}

function cacheRoute(route) {
  if (!route?.routeNo && !route?.routeId) return;
  if (route.routeNo) busanRouteCache.set(`no:${route.routeNo}`, route);
  if (route.routeId) busanRouteCache.set(`id:${route.routeId}`, route);
}

async function fetchAllRoutes(apiKey) {
  if (allRoutesCache.value) return allRoutesCache.value;

  const parsed = await fetchBusanItems("busInfo", {}, apiKey);
  const routes = dedupeBy(
    parsed.items.map((raw) => normalizeRouteInfo(raw)).filter((route) => route.routeNo || route.routeId),
    (route) => route.routeId || route.routeNo
  ).sort(routeSort);

  for (const route of routes) cacheRoute(route);
  allRoutesCache.value = routes;
  return routes;
}

async function fetchBusanRoute(apiKey, route) {
  const noKey = route.routeNo ? `no:${route.routeNo}` : "";
  const idKey = route.routeId ? `id:${route.routeId}` : "";
  if (noKey && busanRouteCache.has(noKey)) return busanRouteCache.get(noKey);
  if (idKey && busanRouteCache.has(idKey)) return busanRouteCache.get(idKey);

  const params = {};
  if (route.routeNo) params.lineno = route.routeNo;
  if (route.routeId) params.lineid = route.routeId;

  const parsed = await fetchBusanItems("busInfo", params, apiKey);
  const item = parsed.items.find((raw) => {
    const rawNo = String(raw.buslinenum || "").trim();
    const rawId = String(raw.lineid || "").trim();
    return (route.routeId && rawId === route.routeId) || (route.routeNo && rawNo === route.routeNo);
  }) || parsed.items[0];

  const detail = item ? normalizeRouteInfo(item, route) : normalizeRouteInfo({}, route);
  cacheRoute(detail);
  return detail;
}

async function fetchRouteStops(apiKey, route) {
  if (!route.routeId) return [];
  const parsed = await fetchBusanItems("busInfoByRouteId", { lineid: route.routeId }, apiKey);
  return parsed.items.map((raw) => ({
    arsNo: String(raw.arsno || ""),
    nodeId: String(raw.nodeid || ""),
    name: String(raw.bstopnm || ""),
    lat: toNumber(raw.lat, NaN),
    lng: toNumber(raw.lin, NaN),
    routeNo: String(raw.lineno || route.routeNo || ""),
    routeId: route.routeId,
    routeType: route.routeType
  }));
}

function addRouteToStopMap(map, key, route) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(route);
}

async function buildRouteStopIndex(apiKey) {
  if (routeStopIndexCache.value) return routeStopIndexCache.value;

  const routes = await fetchAllRoutes(apiKey);
  const stopRouteMap = new Map();
  const routeStops = [];

  const routeStopGroups = await mapConcurrent(routes, 10, async (route) => {
    try {
      return { route, stops: await fetchRouteStops(apiKey, route) };
    } catch {
      return { route, stops: [] };
    }
  });

  for (const { route, stops } of routeStopGroups) {
    for (const stop of stops) {
      const indexedRoute = {
        routeId: route.routeId || stop.routeId,
        routeNo: route.routeNo || stop.routeNo,
        routeType: route.routeType || stop.routeType
      };
      if (stop.arsNo) addRouteToStopMap(stopRouteMap, `ars:${stop.arsNo}`, indexedRoute);
      if (stop.nodeId) addRouteToStopMap(stopRouteMap, `node:${stop.nodeId}`, indexedRoute);
      if (Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) {
        routeStops.push({ ...stop, route: indexedRoute });
      }
    }
  }

  routeStopIndexCache.value = { stopRouteMap, routeStops };
  return routeStopIndexCache.value;
}

async function fetchStopRoutesByArrival(apiKey, stop) {
  const cacheKey = makeCacheKey("arrival", { bstopid: stop.nodeId, arsno: stop.arsNo });
  if (stopArrivalCache.has(cacheKey)) return stopArrivalCache.get(cacheKey);

  const candidates = [
    { operation: "busStopArrByBstopid", params: { bstopid: stop.nodeId } },
    { operation: "busStopArrByArsno", params: { arsno: stop.arsNo } }
  ];

  for (const candidate of candidates) {
    if (Object.values(candidate.params).some((value) => !value)) continue;
    try {
      const parsed = await fetchBusanItems(candidate.operation, candidate.params, apiKey);
      const routes = parsed.items
        .map((raw) => ({
          routeId: String(raw.lineid || raw.routeid || ""),
          routeNo: String(raw.lineno || raw.buslinenum || raw.routeno || ""),
          routeType: String(raw.bustype || raw.routetp || "")
        }))
        .filter((route) => route.routeNo || route.routeId);

      if (routes.length) {
        const result = dedupeBy(routes, (route) => route.routeId || route.routeNo).sort(routeSort);
        stopArrivalCache.set(cacheKey, result);
        return result;
      }
    } catch {
      // Some 부산BIMS deployments do not expose both arrival endpoint names.
    }
  }

  stopArrivalCache.set(cacheKey, []);
  return [];
}

function resolveRoutesFromIndex(stop, index) {
  const direct = [];
  if (stop.arsNo) direct.push(...index.stopRouteMap.get(`ars:${stop.arsNo}`) || []);
  if (stop.nodeId) direct.push(...index.stopRouteMap.get(`node:${stop.nodeId}`) || []);
  if (direct.length) return dedupeBy(direct, (route) => route.routeId || route.routeNo).sort(routeSort);

  const name = normalizeName(stop.name);
  const coordMatches = index.routeStops
    .filter((routeStop) => {
      if (normalizeName(routeStop.name) !== name) return false;
      if (!Number.isFinite(routeStop.lat) || !Number.isFinite(routeStop.lng)) return false;
      return distanceMeters(stop.lat, stop.lng, routeStop.lat, routeStop.lng) <= 25;
    })
    .map((routeStop) => routeStop.route);

  return dedupeBy(coordMatches, (route) => route.routeId || route.routeNo).sort(routeSort);
}

async function buildReport({ lat, lng, radius }) {
  const apiKey = await loadApiKey();
  if (!apiKey) {
    throw new Error("API 키가 없습니다. config.local.json 또는 DATA_GO_KR_API_KEY 환경변수에 부산BIMS 서비스키를 저장해 주세요.");
  }

  const centerCad = projectWgs84ToCad(lat, lng);
  const stops = await fetchNearbyStops(apiKey, lat, lng, radius);
  const stopRows = [];
  const routeMap = new Map();
  let routeIndex = null;

  for (const stop of stops) {
    let routes = await fetchStopRoutesByArrival(apiKey, stop);
    if (!routes.length) {
      routeIndex = routeIndex || await buildRouteStopIndex(apiKey);
      routes = resolveRoutesFromIndex(stop, routeIndex);
    }

    stopRows.push({
      ...stop,
      cad: projectWgs84ToCad(stop.lat, stop.lng),
      routeNos: routes.map((route) => route.routeNo).filter(Boolean)
    });

    for (const route of routes) {
      const key = route.routeNo || route.routeId;
      if (!key) continue;
      if (!routeMap.has(key)) {
        routeMap.set(key, {
          ...route,
          stopPointNos: new Set()
        });
      }
      routeMap.get(key).stopPointNos.add(stop.pointNo);
    }
  }

  const routeDetails = [];
  for (const route of Array.from(routeMap.values()).sort(routeSort)) {
    let detail;
    try {
      detail = await fetchBusanRoute(apiKey, route);
    } catch {
      detail = normalizeRouteInfo({}, route);
    }

    routeDetails.push({
      ...detail,
      stopPointNos: Array.from(route.stopPointNos).sort((a, b) => a - b)
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    coordinateSystem: {
      input: "Kakao Maps WGS84 latitude/longitude (EPSG:4326)",
      output: CAD_COORDINATE_SYSTEM
    },
    center: { lat, lng, cad: centerCad },
    radius,
    summary: {
      stopCount: stopRows.length,
      routeCount: routeDetails.length,
      regularCount: routeDetails.filter((route) => !/마을/.test(route.routeGroup)).length,
      villageCount: routeDetails.filter((route) => /마을/.test(route.routeGroup)).length
    },
    stops: stopRows,
    stopRouteTable: stopRows.map((stop) => ({
      pointNo: stop.pointNo,
      stopName: stop.name,
      nodeId: stop.nodeId,
      arsNo: stop.arsNo,
      distance: stop.distance,
      lat: stop.lat,
      lng: stop.lng,
      cad: stop.cad,
      routes: stop.routeNos
    })),
    routeOperationTable: routeDetails
  };
}

async function handleApiReport(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}");
      const lat = toNumber(payload.lat, NaN);
      const lng = toNumber(payload.lng, NaN);
      const radius = Math.min(Math.max(toNumber(payload.radius, 500), 50), 3000);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return badRequest(res, "위도/경도를 확인해 주세요.");
      }

      const report = await buildReport({ lat, lng, radius });
      json(res, 200, report);
    } catch (error) {
      json(res, 500, { error: error.message || "보고서 생성 중 오류가 발생했습니다." });
    }
  });
}

async function handleApiMapConfig(res) {
  const config = await loadLocalConfig();
  const kakaoJavascriptKey = String(process.env.KAKAO_MAP_JS_KEY || config.kakaoJavascriptKey || config.kakaoMapKey || "").trim();
  const naverNcpKeyId = String(process.env.NAVER_MAP_NCP_KEY_ID || config.naverNcpKeyId || config.naverMapKeyId || "").trim();
  const configuredProvider = String(process.env.MAP_PROVIDER || config.mapProvider || "").trim().toLowerCase();
  const provider = configuredProvider || (kakaoJavascriptKey ? "kakao" : (naverNcpKeyId ? "naver" : "osm"));

  json(res, 200, {
    provider,
    kakaoJavascriptKey,
    naverNcpKeyId
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const unsafePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const normalizedPath = path.normalize(unsafePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, normalizedPath);
  if (!filePath.startsWith(publicDir)) return notFound(res);

  try {
    const data = await readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/report") return handleApiReport(req, res);
  if (req.method === "GET" && req.url === "/api/map-config") return handleApiMapConfig(res);
  if (req.method === "GET") return serveStatic(req, res);
  notFound(res);
});

server.listen(PORT, () => {
  console.log(`Busan transit report tool: http://localhost:${PORT}`);
});
