const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5177);
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const BIMS_BASE = "http://apis.data.go.kr/6260000/BusanBIMS";
const SERVER_SERVICE_KEY = process.env.BIMS_SERVICE_KEY || "";
const ACCESS_CODE = process.env.APP_ACCESS_CODE || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1) continue;
    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
}

function hasAccess(req) {
  if (!ACCESS_CODE) return true;
  return req.headers["x-access-code"] === ACCESS_CODE || getCookie(req, "bims_access") === ACCESS_CODE;
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return "";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeStaticPath(requestPath) {
  const pathname = requestPath === "/" ? "/index.html" : requestPath;
  const decoded = decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!filePath.startsWith(PUBLIC_DIR)) return null;
  return filePath;
}

function proxyBims(req, res, url) {
  if (!hasAccess(req)) {
    sendJson(res, 401, { error: "접근 코드가 올바르지 않습니다." });
    return;
  }

  const serviceKey = url.searchParams.get("serviceKey") || SERVER_SERVICE_KEY;
  const endpoint = url.searchParams.get("endpoint") || "";

  if (!serviceKey.trim()) {
    sendJson(res, 400, { error: "공공데이터포털 서비스키가 필요합니다." });
    return;
  }

  if (!/^[A-Za-z0-9]+$/.test(endpoint)) {
    sendJson(res, 400, { error: "허용되지 않은 BIMS endpoint입니다." });
    return;
  }

  const target = new URL(`${BIMS_BASE}/${endpoint}`);
  for (const [key, value] of url.searchParams.entries()) {
    if (key !== "endpoint" && key !== "serviceKey") target.searchParams.set(key, value);
  }
  target.searchParams.set("serviceKey", serviceKey);

  const transport = target.protocol === "https:" ? https : http;
  const upstream = transport.get(target, (upstreamRes) => {
    let body = "";
    upstreamRes.setEncoding("utf8");
    upstreamRes.on("data", (chunk) => {
      body += chunk;
    });
    upstreamRes.on("end", () => {
      send(res, upstreamRes.statusCode || 200, body, {
        "content-type": upstreamRes.headers["content-type"] || "text/xml; charset=utf-8",
        "cache-control": "no-store",
      });
    });
  });

  upstream.on("error", (error) => {
    sendJson(res, 502, { error: `BIMS 요청 실패: ${error.message}` });
  });

  upstream.setTimeout(20000, () => {
    upstream.destroy(new Error("BIMS 응답 시간이 초과되었습니다."));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/login" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!ACCESS_CODE || body.accessCode === ACCESS_CODE) {
        sendJson(res, 200, { ok: true }, {
          "set-cookie": `bims_access=${encodeURIComponent(body.accessCode || "")}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
        });
        return;
      }
      sendJson(res, 401, { error: "Access denied" });
    } catch (error) {
      sendJson(res, 400, { error: "Invalid request" });
    }
    return;
  }

  if (url.pathname === "/api/bims") {
    proxyBims(req, res, url);
    return;
  }

  if (url.pathname === "/api/config") {
    sendJson(res, 200, {
      serverKeyAvailable: Boolean(SERVER_SERVICE_KEY),
      accessCodeRequired: Boolean(ACCESS_CODE),
      authenticated: hasAccess(req),
    });
    return;
  }

  const filePath = safeStaticPath(url.pathname);
  if (!filePath) {
    send(res, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
      return;
    }
    send(res, 200, data, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`BIMS report tool: http://${HOST}:${PORT}`);
});
