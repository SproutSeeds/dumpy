#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const dataDir = process.env.DUMPY_DATA_DIR
  ? path.resolve(process.env.DUMPY_DATA_DIR)
  : path.join(process.cwd(), "data");
const uploadDir = path.join(dataDir, "uploads");
const indexFile = path.join(dataDir, "files.json");
const deletedRetentionMs = 30 * 24 * 60 * 60 * 1000;

const host = process.env.DUMPY_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.DUMPY_PORT || "7331", 10);

let indexQueue = Promise.resolve();

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
    sendJson(response, status, { error: status === 413 ? "That text is too large." : "Dumpy tripped on that one." });
  }
});

server.listen(port, host, () => {
  console.log(`Dumpy is listening on http://${host}:${port}`);
  console.log(`Files live in ${dataDir}`);
});

async function handleList(response) {
  await purgeExpiredDeletedItems();
  const allItems = await readIndex();
  const publicItems = allItems.filter((item) => !item.deletedAt).map(toPublicItem);
  const deletedItems = allItems.filter((item) => item.deletedAt).map(toPublicItem);
  sendJson(response, 200, { files: publicItems, items: publicItems, deletedItems });
}

async function handleUpload(request, response, url) {
  const originalName = normalizeFilename(url.searchParams.get("name") || "untitled");
  const id = randomUUID();
  const storedPath = path.join(uploadDir, id);
  const uploadedAt = new Date().toISOString();
  const type = cleanHeaderValue(request.headers["content-type"]) || "application/octet-stream";

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
    uploadedAt
  };

  await updateIndex((files) => {
    files.unshift(file);
    return file;
  });

  sendJson(response, 201, { file: toPublicItem(file), item: toPublicItem(file) });
}

async function handleTextDump(request, response) {
  const body = await readJsonBody(request, 1024 * 1024);
  const content = typeof body.content === "string" ? body.content.trim() : "";

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
        uploadedAt
      }
    : {
        id: randomUUID(),
        kind: "text",
        text: content.slice(0, 1_000_000),
        uploadedAt
      };

  await updateIndex((items) => {
    items.unshift(item);
    return item;
  });

  sendJson(response, 201, { item: toPublicItem(item) });
}

async function handleSoftDelete(response, id) {
  let deletedItem = null;

  await updateIndex((items) => {
    const item = items.find((candidate) => candidate.id === id && !candidate.deletedAt);

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

  await updateIndex((items) => {
    const item = items.find((candidate) => candidate.id === id && candidate.deletedAt);

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

  await updateIndex((items) => {
    const index = items.findIndex((candidate) => candidate.id === id && candidate.deletedAt);

    if (index === -1) {
      return null;
    }

    [removedItem] = items.splice(index, 1);
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
  const files = await readIndex();
  const file = files.find((candidate) => isFileItem(candidate) && !candidate.deletedAt && candidate.id === id);

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

async function readIndex() {
  try {
    const raw = await readFile(indexFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeIndex(files) {
  await mkdir(dataDir, { recursive: true });
  const tmpFile = `${indexFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify(files, null, 2)}\n`);
  await rename(tmpFile, indexFile);
}

async function updateIndex(callback) {
  const next = indexQueue.then(async () => {
    const files = await readIndex();
    const result = callback(files);
    await writeIndex(files);
    return result;
  });

  indexQueue = next.catch(() => {});
  return next;
}

async function purgeExpiredDeletedItems() {
  const fileIds = [];
  const now = Date.now();

  await updateIndex((items) => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];

      if (!item.deletedAt || deletionExpiresAt(item.deletedAt).getTime() > now) {
        continue;
      }

      const [removed] = items.splice(index, 1);

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

  if (item.kind === "link") {
    return {
      id: item.id,
      kind: "link",
      url: item.url,
      label: item.label || labelForUrl(item.url),
      uploadedAt: item.uploadedAt,
      ...deletedMeta
    };
  }

  if (item.kind === "text") {
    return {
      id: item.id,
      kind: "text",
      text: item.text || "",
      uploadedAt: item.uploadedAt,
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
    ...deletedMeta,
    href: `/files/${encodeURIComponent(item.id)}/${encodeURIComponent(item.name)}`,
    previewHref: `/preview/${encodeURIComponent(item.id)}/${encodeURIComponent(item.name)}`
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

function normalizeFilename(name) {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base || "untitled").slice(0, 220);
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
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
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
