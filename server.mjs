#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const cliOptions = parseCliOptions(process.argv.slice(2));

if (cliOptions.help) {
  printHelp();
  process.exit(0);
}

const explicitDataDir = cliOptions.dataDir || process.env.DUMPY_DATA_DIR || "";
const defaultDataDir = getDefaultDataDir();
const dataDir = explicitDataDir ? path.resolve(explicitDataDir) : defaultDataDir;
const uploadDir = path.join(dataDir, "uploads");
const indexFile = path.join(dataDir, "files.json");
const legacyDataDir = path.join(process.cwd(), "data");
const deletedRetentionMs = 30 * 24 * 60 * 60 * 1000;

const host = process.env.DUMPY_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.DUMPY_PORT || "7331", 10);
const storageInfo = {
  dataDir,
  uploadDir,
  isDefault: !explicitDataDir,
  source: explicitDataDir ? (cliOptions.dataDir ? "cli" : "env") : "default"
};

let storeQueue = Promise.resolve();

await migrateLegacyDataIfNeeded();
await mkdir(uploadDir, { recursive: true });
await purgeExpiredDeletedItems();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/files") {
      await handleList(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/items") {
      await handleTextDump(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/parties") {
      await handleCreateParty(request, response);
      return;
    }

    const partyRoute = url.pathname.match(/^\/api\/parties\/([^/]+)(?:\/(restore|permanent|download))?$/);

    if (partyRoute && request.method === "PATCH" && !partyRoute[2]) {
      await handleRenameParty(request, response, partyRoute[1]);
      return;
    }

    if (partyRoute && request.method === "DELETE" && !partyRoute[2]) {
      await handleSoftDeleteParty(response, partyRoute[1]);
      return;
    }

    if (partyRoute && request.method === "POST" && partyRoute[2] === "restore") {
      await handleRestoreParty(response, partyRoute[1]);
      return;
    }

    if (partyRoute && request.method === "DELETE" && partyRoute[2] === "permanent") {
      await handlePermanentDeleteParty(response, partyRoute[1]);
      return;
    }

    if (partyRoute && (request.method === "GET" || request.method === "HEAD") && partyRoute[2] === "download") {
      await handleDownloadParty(request, response, partyRoute[1]);
      return;
    }

    const itemRoute = url.pathname.match(/^\/api\/items\/([^/]+)(?:\/(restore|permanent))?$/);

    if (itemRoute && request.method === "DELETE" && !itemRoute[2]) {
      await handleSoftDelete(response, itemRoute[1]);
      return;
    }

    if (itemRoute && request.method === "POST" && itemRoute[2] === "restore") {
      await handleRestore(response, itemRoute[1]);
      return;
    }

    if (itemRoute && request.method === "DELETE" && itemRoute[2] === "permanent") {
      await handlePermanentDelete(response, itemRoute[1]);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/files") {
      await handleUpload(request, response, url);
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/preview/")) {
      await handleFileResponse(request, response, url, "inline");
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/files/")) {
      await handleFileResponse(request, response, url, "attachment");
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response, url);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    const message =
      status === 413 ? "That text is too large." : status < 500 && error.message ? error.message : "Dumpy tripped on that one.";
    sendJson(response, status, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`Dumpy is listening on http://${host}:${port}`);
  console.log(`Dumps live in ${dataDir}`);
});

async function handleList(response) {
  await purgeExpiredDeletedItems();
  const store = await readStore();
  const activePartyIds = new Set(store.parties.filter((party) => !party.deletedAt).map((party) => party.id));
  const publicItems = store.items
    .filter((item) => !item.deletedAt && isVisibleItem(item, activePartyIds))
    .map(toPublicItem);
  const deletedItems = store.items
    .filter((item) => item.deletedAt && isVisibleItem(item, activePartyIds))
    .map(toPublicItem);
  const publicParties = store.parties
    .filter((party) => !party.deletedAt)
    .map((party) => toPublicParty(party, store.items));
  const deletedParties = store.parties
    .filter((party) => party.deletedAt)
    .map((party) => toPublicParty(party, store.items));

  sendJson(response, 200, {
    files: publicItems,
    items: publicItems,
    deletedItems,
    parties: publicParties,
    deletedParties,
    storage: storageInfo
  });
}

async function handleUpload(request, response, url) {
  const originalName = normalizeFilename(url.searchParams.get("name") || "untitled");
  const relativePath = normalizeRelativePath(url.searchParams.get("relativePath") || "", originalName);
  const partyId = normalizeOptionalId(url.searchParams.get("partyId") || "");
  const id = randomUUID();
  const storedPath = path.join(uploadDir, id);
  const uploadedAt = new Date().toISOString();
  const type = cleanHeaderValue(request.headers["content-type"]) || "application/octet-stream";

  if (partyId) {
    assertPartyCanReceive(await readStore(), partyId);
  }

  try {
    await pipeline(request, createWriteStream(storedPath, { flags: "wx" }));
  } catch (error) {
    await rm(storedPath, { force: true });
    throw error;
  }

  const savedStat = await stat(storedPath);
  const file = {
    id,
    kind: "file",
    name: originalName,
    size: savedStat.size,
    mimeType: type,
    uploadedAt,
    partyId,
    relativePath
  };

  await updateStore((store) => {
    assertPartyCanReceive(store, partyId);
    store.items.unshift(file);
    return file;
  });

  sendJson(response, 201, { file: toPublicItem(file), item: toPublicItem(file) });
}

async function handleTextDump(request, response) {
  const body = await readJsonBody(request, 1024 * 1024);
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const partyId = normalizeOptionalId(body.partyId);

  if (!content) {
    sendJson(response, 400, { error: "Nothing to dump." });
    return;
  }

  const uploadedAt = new Date().toISOString();
  const url = normalizeUrlCandidate(content);
  const item = url
    ? {
        id: randomUUID(),
        kind: "link",
        url,
        label: labelForUrl(url),
        uploadedAt,
        partyId
      }
    : {
        id: randomUUID(),
        kind: "text",
        text: content.slice(0, 1_000_000),
        uploadedAt,
        partyId
      };

  await updateStore((store) => {
    assertPartyCanReceive(store, partyId);
    store.items.unshift(item);
    return item;
  });

  sendJson(response, 201, { item: toPublicItem(item) });
}

async function handleCreateParty(request, response) {
  const body = await readJsonBody(request, 64 * 1024);
  const name = normalizePartyName(body.name);

  if (!name) {
    sendJson(response, 400, { error: "Party needs a name." });
    return;
  }

  const party = {
    id: randomUUID(),
    kind: "party",
    name,
    createdAt: new Date().toISOString()
  };

  await updateStore((store) => {
    store.parties.unshift(party);
    return party;
  });

  sendJson(response, 201, { party: toPublicParty(party, []) });
}

async function handleRenameParty(request, response, id) {
  const body = await readJsonBody(request, 64 * 1024);
  const name = normalizePartyName(body.name);
  let renamedParty = null;

  if (!name) {
    sendJson(response, 400, { error: "Party needs a name." });
    return;
  }

  await updateStore((store) => {
    const party = store.parties.find((candidate) => candidate.id === id && !candidate.deletedAt);

    if (!party) {
      return null;
    }

    party.name = name;
    renamedParty = party;
    return party;
  });

  if (!renamedParty) {
    sendJson(response, 404, { error: "Party not found" });
    return;
  }

  sendJson(response, 200, { party: toPublicParty(renamedParty, []) });
}

async function handleSoftDeleteParty(response, id) {
  let deletedParty = null;

  await updateStore((store) => {
    const party = store.parties.find((candidate) => candidate.id === id && !candidate.deletedAt);

    if (!party) {
      return null;
    }

    party.deletedAt = new Date().toISOString();
    deletedParty = party;
    return party;
  });

  if (!deletedParty) {
    sendJson(response, 404, { error: "Party not found" });
    return;
  }

  sendJson(response, 200, { party: toPublicParty(deletedParty, []) });
}

async function handleRestoreParty(response, id) {
  let restoredParty = null;

  await updateStore((store) => {
    const party = store.parties.find((candidate) => candidate.id === id && candidate.deletedAt);

    if (!party) {
      return null;
    }

    delete party.deletedAt;
    restoredParty = party;
    return party;
  });

  if (!restoredParty) {
    sendJson(response, 404, { error: "Party not found" });
    return;
  }

  sendJson(response, 200, { party: toPublicParty(restoredParty, []) });
}

async function handlePermanentDeleteParty(response, id) {
  let removedParty = null;
  const removedItems = [];

  await updateStore((store) => {
    const partyIndex = store.parties.findIndex((candidate) => candidate.id === id && candidate.deletedAt);

    if (partyIndex === -1) {
      return null;
    }

    [removedParty] = store.parties.splice(partyIndex, 1);

    for (let index = store.items.length - 1; index >= 0; index -= 1) {
      if (store.items[index].partyId === id) {
        const [removedItem] = store.items.splice(index, 1);
        removedItems.push(removedItem);
      }
    }

    return removedParty;
  });

  if (!removedParty) {
    sendJson(response, 404, { error: "Party not found" });
    return;
  }

  await Promise.allSettled(removedItems.map(removeStoredFileIfNeeded));
  sendJson(response, 200, { ok: true });
}

async function handleDownloadParty(request, response, id) {
  const store = await readStore();
  const party = store.parties.find((candidate) => candidate.id === id && !candidate.deletedAt);

  if (!party) {
    sendJson(response, 404, { error: "Party not found" });
    return;
  }

  const partyItems = store.items.filter((item) => item.partyId === id && !item.deletedAt);
  const zipEntries = await buildPartyZipEntries(party, partyItems);
  const zip = buildZip(zipEntries);
  const filename = `${slugForFilename(party.name || "dump-party") || "dump-party"}.zip`;

  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Length": zip.length,
    "Content-Disposition": contentDisposition(filename),
    "Cache-Control": "private, max-age=0, must-revalidate"
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  response.end(zip);
}

async function handleSoftDelete(response, id) {
  let deletedItem = null;

  await updateStore((store) => {
    const item = store.items.find((candidate) => candidate.id === id && !candidate.deletedAt);

    if (!item) {
      return null;
    }

    item.deletedAt = new Date().toISOString();
    deletedItem = item;
    return item;
  });

  if (!deletedItem) {
    sendJson(response, 404, { error: "Item not found" });
    return;
  }

  sendJson(response, 200, { item: toPublicItem(deletedItem) });
}

async function handleRestore(response, id) {
  let restoredItem = null;

  await updateStore((store) => {
    const item = store.items.find((candidate) => candidate.id === id && candidate.deletedAt);

    if (!item) {
      return null;
    }

    delete item.deletedAt;
    restoredItem = item;
    return item;
  });

  if (!restoredItem) {
    sendJson(response, 404, { error: "Item not found" });
    return;
  }

  sendJson(response, 200, { item: toPublicItem(restoredItem) });
}

async function handlePermanentDelete(response, id) {
  let removedItem = null;

  await updateStore((store) => {
    const index = store.items.findIndex((candidate) => candidate.id === id && candidate.deletedAt);

    if (index === -1) {
      return null;
    }

    [removedItem] = store.items.splice(index, 1);
    return removedItem;
  });

  if (!removedItem) {
    sendJson(response, 404, { error: "Item not found" });
    return;
  }

  await removeStoredFileIfNeeded(removedItem);
  sendJson(response, 200, { ok: true });
}

async function handleFileResponse(request, response, url, disposition) {
  const [, , id] = url.pathname.split("/");
  const store = await readStore();
  const activePartyIds = new Set(store.parties.filter((party) => !party.deletedAt).map((party) => party.id));
  const file = store.items.find(
    (candidate) => isFileItem(candidate) && !candidate.deletedAt && isVisibleItem(candidate, activePartyIds) && candidate.id === id
  );

  if (!file) {
    sendJson(response, 404, { error: "File not found" });
    return;
  }

  const storedPath = path.join(uploadDir, file.id);
  let savedStat;

  try {
    savedStat = await stat(storedPath);
  } catch {
    sendJson(response, 404, { error: "File is missing on disk" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": file.mimeType || file.type || "application/octet-stream",
    "Content-Length": savedStat.size,
    "Content-Disposition": contentDisposition(file.name, disposition),
    "Cache-Control": "private, max-age=0, must-revalidate"
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(storedPath).pipe(response);
}

async function serveStatic(request, response, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const decodedPath = decodeURIComponent(requestPath).replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, decodedPath);
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": fileStat.size,
      "Cache-Control": "no-cache"
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function readStore() {
  try {
    const raw = await readFile(indexFile, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyStore();
    }

    throw error;
  }
}

async function writeStore(store) {
  await mkdir(dataDir, { recursive: true });
  const tmpFile = `${indexFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify(normalizeStore(store), null, 2)}\n`);
  await rename(tmpFile, indexFile);
}

async function updateStore(callback) {
  const next = storeQueue.then(async () => {
    const store = await readStore();
    const result = callback(store);
    await writeStore(store);
    return result;
  });

  storeQueue = next.catch(() => {});
  return next;
}

async function purgeExpiredDeletedItems() {
  const fileIds = [];
  const now = Date.now();

  await updateStore((store) => {
    const expiredPartyIds = new Set();

    for (let index = store.parties.length - 1; index >= 0; index -= 1) {
      const party = store.parties[index];

      if (!party.deletedAt || deletionExpiresAt(party.deletedAt).getTime() > now) {
        continue;
      }

      const [removedParty] = store.parties.splice(index, 1);
      expiredPartyIds.add(removedParty.id);
    }

    for (let index = store.items.length - 1; index >= 0; index -= 1) {
      const item = store.items[index];
      const partyExpired = item.partyId && expiredPartyIds.has(item.partyId);

      if (!partyExpired && (!item.deletedAt || deletionExpiresAt(item.deletedAt).getTime() > now)) {
        continue;
      }

      const [removed] = store.items.splice(index, 1);

      if (isFileItem(removed)) {
        fileIds.push(removed.id);
      }
    }

    return null;
  });

  await Promise.allSettled(fileIds.map((id) => rm(path.join(uploadDir, id), { force: true })));
}

async function removeStoredFileIfNeeded(item) {
  if (isFileItem(item)) {
    await rm(path.join(uploadDir, item.id), { force: true });
  }
}

async function readJsonBody(request, maxBytes) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > maxBytes) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function toPublicItem(item) {
  const deletedMeta = deletedPublicMeta(item);
  const partyMeta = {
    partyId: item.partyId || null
  };

  if (item.kind === "link") {
    return {
      id: item.id,
      kind: "link",
      url: item.url,
      label: item.label || labelForUrl(item.url),
      uploadedAt: item.uploadedAt,
      ...partyMeta,
      ...deletedMeta
    };
  }

  if (item.kind === "text") {
    return {
      id: item.id,
      kind: "text",
      text: item.text || "",
      uploadedAt: item.uploadedAt,
      ...partyMeta,
      ...deletedMeta
    };
  }

  return {
    id: item.id,
    kind: "file",
    name: item.name,
    size: item.size,
    mimeType: item.mimeType || item.type,
    uploadedAt: item.uploadedAt,
    relativePath: item.relativePath || "",
    ...partyMeta,
    ...deletedMeta,
    href: `/files/${encodeURIComponent(item.id)}/${encodeURIComponent(item.name)}`,
    previewHref: `/preview/${encodeURIComponent(item.id)}/${encodeURIComponent(item.name)}`
  };
}

function toPublicParty(party, items) {
  const deletedMeta = deletedPublicMeta(party);
  const activeItemCount = items.filter((item) => item.partyId === party.id && !item.deletedAt).length;
  const totalItemCount = items.filter((item) => item.partyId === party.id).length;

  return {
    id: party.id,
    kind: "party",
    name: party.name || "Dump Party",
    createdAt: party.createdAt,
    itemCount: party.deletedAt ? totalItemCount : activeItemCount,
    ...deletedMeta
  };
}

function deletedPublicMeta(item) {
  if (!item.deletedAt) {
    return {};
  }

  return {
    deletedAt: item.deletedAt,
    purgeAt: deletionExpiresAt(item.deletedAt).toISOString()
  };
}

function deletionExpiresAt(deletedAt) {
  const deletedTime = new Date(deletedAt).getTime();
  return new Date((Number.isFinite(deletedTime) ? deletedTime : Date.now()) + deletedRetentionMs);
}

function isFileItem(item) {
  return !item.kind || item.kind === "file";
}

function isVisibleItem(item, activePartyIds) {
  return !item.partyId || activePartyIds.has(item.partyId);
}

function assertPartyCanReceive(store, partyId) {
  if (!partyId) {
    return;
  }

  const party = store.parties.find((candidate) => candidate.id === partyId && !candidate.deletedAt);

  if (!party) {
    throw httpError(400, "Dump party not found.");
  }
}

function normalizeStore(value) {
  if (Array.isArray(value)) {
    return {
      schemaVersion: 2,
      parties: [],
      items: value.map(normalizeStoredItem).filter(Boolean)
    };
  }

  return {
    schemaVersion: 2,
    parties: Array.isArray(value?.parties) ? value.parties.map(normalizeStoredParty).filter(Boolean) : [],
    items: Array.isArray(value?.items) ? value.items.map(normalizeStoredItem).filter(Boolean) : []
  };
}

function emptyStore() {
  return {
    schemaVersion: 2,
    parties: [],
    items: []
  };
}

function normalizeStoredParty(party) {
  if (!party || typeof party !== "object" || typeof party.id !== "string") {
    return null;
  }

  return {
    id: party.id,
    kind: "party",
    name: normalizePartyName(party.name) || "Dump Party",
    createdAt: typeof party.createdAt === "string" ? party.createdAt : new Date().toISOString(),
    ...(typeof party.deletedAt === "string" ? { deletedAt: party.deletedAt } : {})
  };
}

function normalizeStoredItem(item) {
  if (!item || typeof item !== "object" || typeof item.id !== "string") {
    return null;
  }

  return {
    ...item,
    partyId: normalizeOptionalId(item.partyId),
    relativePath: normalizeRelativePath(item.relativePath || "", item.name || "")
  };
}

function normalizeFilename(name) {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base || "untitled").slice(0, 220);
}

function normalizeRelativePath(value, fallbackName = "") {
  const raw = typeof value === "string" ? value : "";

  if (!raw) {
    return "";
  }

  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[\u0000-\u001f\u007f]/g, "").trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.slice(0, 160));

  if (!parts.length) {
    return "";
  }

  const fallbackBase = normalizeFilename(fallbackName);
  const lastPart = normalizeFilename(parts[parts.length - 1] || fallbackBase);
  parts[parts.length - 1] = lastPart || fallbackBase;
  return parts.join("/").slice(0, 800);
}

function normalizePartyName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizeOptionalId(value) {
  return typeof value === "string" && /^[a-z0-9-]{8,80}$/i.test(value) ? value : null;
}

function cleanHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return typeof value === "string" ? value.replace(/[\r\n]/g, "") : "";
}

function normalizeUrlCandidate(value) {
  if (/\s/.test(value)) {
    return "";
  }

  let candidate = value;

  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) {
    if (!looksLikeDomain(candidate)) {
      return "";
    }

    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function looksLikeDomain(value) {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(value);
}

function labelForUrl(value) {
  try {
    const url = new URL(value);
    const pathLabel = url.pathname === "/" ? "" : url.pathname;
    return `${url.hostname}${pathLabel}`.slice(0, 220);
  } catch {
    return value;
  }
}

function contentDisposition(filename, disposition = "attachment") {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

function encodeRfc5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8"
  };

  return types[extension] || "application/octet-stream";
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(text);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseCliOptions(args) {
  const options = {
    dataDir: "",
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--data-dir") {
      options.dataDir = args[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--data-dir=")) {
      options.dataDir = arg.slice("--data-dir=".length);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Dumpy

Usage:
  dumpy-files [--data-dir PATH]

Options:
  --data-dir PATH  Store Dumpy data in PATH instead of the OS app-data folder.

Environment:
  DUMPY_DATA_DIR   Same as --data-dir.
  DUMPY_HOST       Host to bind. Default: 127.0.0.1
  DUMPY_PORT       Port to bind. Default: 7331
`);
}

function getDefaultDataDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Dumpy");
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Dumpy");
  }

  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "dumpy");
}

async function migrateLegacyDataIfNeeded() {
  if (explicitDataDir || path.resolve(legacyDataDir) === path.resolve(dataDir)) {
    return;
  }

  const legacyIndex = path.join(legacyDataDir, "files.json");

  if (await pathExists(indexFile) || !(await pathExists(legacyIndex))) {
    return;
  }

  await mkdir(path.dirname(dataDir), { recursive: true });
  await cp(legacyDataDir, dataDir, { recursive: true, force: false, errorOnExist: false });
  storageInfo.migratedFrom = legacyDataDir;
  console.log(`Copied legacy Dumpy data from ${legacyDataDir} to ${dataDir}`);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function buildPartyZipEntries(party, items) {
  const root = sanitizeZipPath(party.name || "dump-party") || "dump-party";
  const usedPaths = new Set();
  const entries = [];

  for (const item of items) {
    if (isFileItem(item)) {
      const storedPath = path.join(uploadDir, item.id);

      try {
        const data = await readFile(storedPath);
        const wantedPath = zipPathForFile(party, item);
        entries.push({
          name: uniqueZipPath(`${root}/${wantedPath || item.id}`, usedPaths),
          data
        });
      } catch {
        entries.push({
          name: uniqueZipPath(`${root}/missing-files/${item.id}.txt`, usedPaths),
          data: Buffer.from(`Missing file on disk: ${item.name || item.id}\n`, "utf8")
        });
      }

      continue;
    }

    if (item.kind === "link") {
      entries.push({
        name: uniqueZipPath(`${root}/links/${slugForFilename(item.label || item.url || item.id)}.txt`, usedPaths),
        data: Buffer.from(`${item.url || ""}\n`, "utf8")
      });
      continue;
    }

    if (item.kind === "text") {
      entries.push({
        name: uniqueZipPath(`${root}/text/${slugForFilename(itemTitleForZip(item))}.txt`, usedPaths),
        data: Buffer.from(`${item.text || ""}\n`, "utf8")
      });
    }
  }

  if (!entries.length) {
    entries.push({
      name: `${root}/empty.txt`,
      data: Buffer.from("This Dump Party is empty.\n", "utf8")
    });
  }

  return entries;
}

function itemTitleForZip(item) {
  const compact = String(item.text || item.id || "text")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return compact || item.id || "text";
}

function zipPathForFile(party, item) {
  const partyRoot = sanitizeZipSegment(party.name || "");
  const wantedPath = sanitizeZipPath(item.relativePath || item.name || `${item.id}.bin`);

  if (partyRoot && wantedPath === partyRoot) {
    return sanitizeZipSegment(item.name || item.id);
  }

  if (partyRoot && wantedPath.startsWith(`${partyRoot}/`)) {
    return wantedPath.slice(partyRoot.length + 1);
  }

  return wantedPath;
}

function uniqueZipPath(name, usedPaths) {
  const cleanName = sanitizeZipPath(name) || "dump";
  let candidate = cleanName;
  let index = 2;
  const extension = path.posix.extname(cleanName);
  const base = extension ? cleanName.slice(0, -extension.length) : cleanName;

  while (usedPaths.has(candidate)) {
    candidate = `${base}-${index}${extension}`;
    index += 1;
  }

  usedPaths.add(candidate);
  return candidate;
}

function sanitizeZipPath(value) {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => sanitizeZipSegment(part))
    .filter(Boolean);
  return parts.join("/");
}

function sanitizeZipSegment(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+$/, "")
    .trim()
    .slice(0, 120);
}

function slugForFilename(value) {
  return (
    sanitizeZipSegment(value)
      .replace(/[\\/]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "dump"
  );
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
