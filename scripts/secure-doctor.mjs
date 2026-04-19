#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const officialHost = process.env.DUMPY_TAILSCALE_HOST || "codys-mac-studio-1.tail649edd.ts.net";
const officialPort = process.env.DUMPY_TAILSCALE_PORT || "7331";
const localPort = process.env.DUMPY_LOCAL_PORT || "7331";
const officialRouteKey = `${officialHost}:${officialPort}`;
const officialUrl = `https://${officialRouteKey}/`;
const officialHealthUrl = `${officialUrl}healthz`;
const expectedProxy = `http://127.0.0.1:${localPort}`;
const allowedExtraRoutes = parseAllowedExtraRoutes(
  process.env.DUMPY_ALLOWED_EXTRA_SERVE_ROUTES || `${officialHost}:443/->http://127.0.0.1:4477`
);

const checks = [];

try {
  const serveJson = await runJson("tailscale", ["serve", "status", "--json"]);
  const funnelJson = await runJson("tailscale", ["funnel", "status", "--json"]);
  const funnelText = await runText("tailscale", ["funnel", "status"]);
  const routes = flattenServeRoutes(serveJson);

  assertExpectedServeRoute(routes);
  assertNoUnexpectedDumpyRoutes(routes);
  assertNoUnexpectedServeRoutes(routes);
  assertFunnelDisabled(funnelJson, funnelText);
  await assertHealth();

  console.log("Dumpy secure doctor: OK");
  for (const check of checks) {
    console.log(`- ${check}`);
  }
  console.log(`Official URL: ${officialUrl}`);
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

function assertExpectedServeRoute(routes) {
  const route = routes.find(
    (candidate) => candidate.hostPort === officialRouteKey && candidate.path === "/" && candidate.proxy === expectedProxy
  );

  if (!route) {
    throw new Error(`Missing official route: ${officialRouteKey}/ -> ${expectedProxy}`);
  }

  checks.push(`Serve route exists: ${officialRouteKey}/ -> ${expectedProxy}`);
}

function assertNoUnexpectedDumpyRoutes(routes) {
  const staleRoutes = routes.filter(
    (route) => route.proxy === expectedProxy && !(route.hostPort === officialRouteKey && route.path === "/")
  );

  if (staleRoutes.length) {
    throw new Error(`Unexpected extra Dumpy route(s): ${formatRoutes(staleRoutes)}`);
  }

  checks.push("No stale alternate Dumpy Serve routes");
}

function assertNoUnexpectedServeRoutes(routes) {
  const unexpected = routes.filter(
    (route) =>
      !(route.hostPort === officialRouteKey && route.path === "/" && route.proxy === expectedProxy) &&
      !allowedExtraRoutes.some((allowed) => route.hostPort === allowed.hostPort && route.path === allowed.path && route.proxy === allowed.proxy)
  );

  if (unexpected.length) {
    throw new Error(`Unexpected Serve route(s): ${formatRoutes(unexpected)}`);
  }

  checks.push("No unexpected Tailscale Serve routes");
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

async function assertHealth() {
  const response = await fetch(officialHealthUrl);

  if (!response.ok) {
    throw new Error(`Health check failed: ${officialHealthUrl} returned ${response.status}`);
  }

  const payload = await response.json();

  if (payload?.ok !== true || payload?.app !== "dumpy") {
    throw new Error(`Unexpected health payload: ${JSON.stringify(payload)}`);
  }

  checks.push(`Health check passed: ${officialHealthUrl} -> ${JSON.stringify(payload)}`);
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

function parseAllowedExtraRoutes(value) {
  return String(value || "")
    .split(",")
    .map((route) => route.trim())
    .filter(Boolean)
    .map((route) => {
      const [left, proxy] = route.split("->");
      const slashIndex = left.indexOf("/");

      if (!proxy || slashIndex === -1) {
        throw new Error(`Invalid DUMPY_ALLOWED_EXTRA_SERVE_ROUTES entry: ${route}`);
      }

      return {
        hostPort: left.slice(0, slashIndex),
        path: left.slice(slashIndex) || "/",
        proxy
      };
    });
}

function formatRoutes(routes) {
  return routes.map((route) => `${route.hostPort}${route.path} -> ${route.proxy}`).join(", ");
}
