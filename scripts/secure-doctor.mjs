#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const officialUrl = normalizeUrl(process.env.DUMPY_OFFICIAL_URL || "https://dumpy.tail649edd.ts.net/");
const localPort = process.env.DUMPY_LOCAL_PORT || "7331";
const officialRouteKey = routeKeyFor(officialUrl);
const officialHealthUrl = new URL("/healthz", officialUrl).href;
const localHealthUrl = `http://127.0.0.1:${localPort}/healthz`;
const expectedProxy = `http://127.0.0.1:${localPort}`;

const checks = [];

try {
  const serveJson = await runJson("tailscale", ["serve", "status", "--json"]);
  const funnelJson = await runJson("tailscale", ["funnel", "status", "--json"]);
  const funnelText = await runText("tailscale", ["funnel", "status"]);
  const routes = flattenServeRoutes(serveJson);

  assertOfficialServeRouteIfPresent(routes);
  assertNoStaleDumpyRoutes(routes);
  noteOtherServeRoutes(routes);
  assertFunnelDisabled(funnelJson, funnelText);
  await assertHealth(localHealthUrl, "local");
  await assertHealth(officialHealthUrl, "canonical");

  console.log("Dumpy secure doctor: OK");
  for (const check of checks) {
    console.log(`- ${check}`);
  }
  console.log(`Official URL: ${officialUrl.href}`);
} catch (error) {
  console.error("Dumpy secure doctor: FAIL");
  console.error(error.message || error);
  process.exitCode = 1;
}

async function runJson(command, args) {
  const output = await runText(command, args);
  const jsonStart = output.indexOf("{");

  if (jsonStart === -1) {
    throw new Error(`${command} ${args.join(" ")} did not return JSON`);
  }

  return JSON.parse(output.slice(jsonStart));
}

async function runText(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    maxBuffer: 1024 * 1024
  });
  return stdout;
}

function flattenServeRoutes(config) {
  const web = config?.Web && typeof config.Web === "object" ? config.Web : {};
  const routes = [];

  for (const [hostPort, entry] of Object.entries(web)) {
    const handlers = entry?.Handlers && typeof entry.Handlers === "object" ? entry.Handlers : {};

    for (const [path, handler] of Object.entries(handlers)) {
      routes.push({
        hostPort,
        path,
        proxy: handler?.Proxy || ""
      });
    }
  }

  return routes;
}

function assertOfficialServeRouteIfPresent(routes) {
  const officialRoutes = routes.filter((route) => route.hostPort === officialRouteKey);

  if (!officialRoutes.length) {
    checks.push("Canonical Serve route is externally managed");
    return;
  }

  const route = officialRoutes.find((candidate) => candidate.path === "/" && candidate.proxy === expectedProxy);

  if (!route) {
    throw new Error(`Official Dumpy Serve route does not point to ${expectedProxy}: ${formatRoutes(officialRoutes)}`);
  }

  checks.push(`Official Serve route exists: ${route.hostPort}/ -> ${expectedProxy}`);
}

function assertNoStaleDumpyRoutes(routes) {
  const staleRoutes = routes.filter(
    (route) =>
      route.proxy === expectedProxy &&
      !(
        route.hostPort === officialRouteKey &&
        route.path === "/"
      )
  );

  if (staleRoutes.length) {
    throw new Error(`Unexpected extra Dumpy route(s): ${formatRoutes(staleRoutes)}`);
  }

  checks.push("No stale alternate Dumpy Serve routes");
}

function noteOtherServeRoutes(routes) {
  const otherRoutes = routes.filter(
    (route) =>
      !(
        route.hostPort === officialRouteKey &&
        route.path === "/" &&
        route.proxy === expectedProxy
      )
  );

  if (!otherRoutes.length) {
    checks.push("No other node Serve routes present");
    return;
  }

  checks.push(`${otherRoutes.length} non-Dumpy Serve route(s) left untouched`);
}

function assertFunnelDisabled(funnelJson, funnelText) {
  if (hasTruthyFunnelFlag(funnelJson)) {
    throw new Error("Tailscale Funnel appears enabled in JSON status");
  }

  const routeLines = funnelText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("https://"));
  const publicRoutes = routeLines.filter((line) => !line.includes("(tailnet only)"));

  if (publicRoutes.length) {
    throw new Error(`Tailscale Funnel route(s) not marked tailnet-only: ${publicRoutes.join(", ")}`);
  }

  checks.push("Tailscale Funnel is not enabled");
}

async function assertHealth(url, label) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${label} health check failed: ${url} returned ${response.status}`);
  }

  const payload = await response.json();

  if (payload?.ok !== true || payload?.app !== "dumpy" || typeof payload?.version !== "string") {
    throw new Error(`Unexpected health payload: ${JSON.stringify(payload)}`);
  }

  checks.push(`${label} health check passed: ${url} -> ${JSON.stringify(payload)}`);
}

function hasTruthyFunnelFlag(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, child] of Object.entries(value)) {
    if (/funnel/i.test(key) && child === true) {
      return true;
    }

    if (hasTruthyFunnelFlag(child)) {
      return true;
    }
  }

  return false;
}

function formatRoutes(routes) {
  return routes.map((route) => `${route.hostPort}${route.path} -> ${route.proxy}`).join(", ");
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function routeKeyFor(url) {
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.hostname}:${port}`;
}
