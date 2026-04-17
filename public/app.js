const fileInput = document.querySelector("#fileInput");
const chooseButton = document.querySelector("#chooseButton");
const dropZone = document.querySelector("#dropZone");
const fileList = document.querySelector("#fileList");
const statusText = document.querySelector("#statusText");
const refreshButton = document.querySelector("#refreshButton");
const progressBar = document.querySelector("#progressBar");
const dumpForm = document.querySelector("#dumpForm");
const dumpInput = document.querySelector("#dumpInput");
const previewOverlay = document.querySelector("#previewOverlay");
const previewPanel = document.querySelector(".preview-panel");
const previewTitle = document.querySelector("#previewTitle");
const previewBody = document.querySelector("#previewBody");
const previewClose = document.querySelector("#previewClose");
const previewDownload = document.querySelector("#previewDownload");
const previewFooter = document.querySelector(".preview-footer");
const deletedSpace = document.querySelector("#deletedSpace");
const deletedList = document.querySelector("#deletedList");
const deletedCount = document.querySelector("#deletedCount");
const confirmOverlay = document.querySelector("#confirmOverlay");
const confirmPanel = document.querySelector(".confirm-panel");
const confirmDetail = document.querySelector("#confirmDetail");
const confirmYes = document.querySelector("#confirmYes");
const confirmNo = document.querySelector("#confirmNo");

let refreshTimer = window.setInterval(loadFiles, 8000);
let pendingConfirm = null;

chooseButton.addEventListener("click", () => fileInput.click());
refreshButton.addEventListener("click", loadFiles);
dumpForm.addEventListener("submit", dumpText);
previewClose.addEventListener("click", closePreview);
previewOverlay.addEventListener("click", (event) => {
  if (event.target === previewOverlay) {
    closePreview();
  }
});
confirmOverlay.addEventListener("click", (event) => {
  if (event.target === confirmOverlay) {
    settleConfirm(false);
  }
});
confirmYes.addEventListener("click", () => settleConfirm(true));
confirmNo.addEventListener("click", () => settleConfirm(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !previewOverlay.hidden) {
    closePreview();
  }

  if (event.key === "Escape" && !confirmOverlay.hidden) {
    settleConfirm(false);
  }
});
dumpInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    dumpForm.requestSubmit();
  }
});
fileInput.addEventListener("change", () => {
  uploadFiles(fileInput.files);
  fileInput.value = "";
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  uploadFiles(event.dataTransfer.files);
});

window.addEventListener("focus", loadFiles);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadFiles();
  }
});

await loadFiles();

async function loadFiles() {
  try {
    const response = await fetch("/api/files", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("List failed");
    }

    const payload = await response.json();
    const items = payload.items || payload.files || [];
    const deletedItems = payload.deletedItems || [];
    renderFiles(items, deletedItems);
    setStatus(items.length ? `${items.length} item${items.length === 1 ? "" : "s"}.` : "Ready.");
  } catch {
    setStatus("Could not refresh.");
  }
}

async function dumpText(event) {
  event.preventDefault();

  const content = dumpInput.value.trim();

  if (!content) {
    dumpInput.focus();
    return;
  }

  try {
    setStatus("Dumping.");
    const response = await fetch("/api/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      throw new Error("Dump failed");
    }

    dumpInput.value = "";
    await loadFiles();
    setStatus("Dropped.");
  } catch {
    setStatus("Dump failed.");
  }
}

async function uploadFiles(fileBag) {
  const files = Array.from(fileBag || []);

  if (!files.length) {
    return;
  }

  window.clearInterval(refreshTimer);
  progressBar.style.width = "0";

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setStatus(`Uploading ${file.name || "untitled"} (${index + 1}/${files.length})`);
      await uploadFile(file);
    }

    progressBar.style.width = "100%";
    setStatus("Dropped.");
    await loadFiles();
  } catch {
    setStatus("Upload failed.");
  } finally {
    window.setTimeout(() => {
      progressBar.style.width = "0";
    }, 700);
    refreshTimer = window.setInterval(loadFiles, 8000);
  }
}

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/files?name=${encodeURIComponent(file.name || "untitled")}`);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        progressBar.style.width = `${Math.round((event.loaded / event.total) * 100)}%`;
      }
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(new Error("Upload failed"));
      }
    });

    request.addEventListener("error", () => reject(new Error("Upload failed")));
    request.addEventListener("abort", () => reject(new Error("Upload aborted")));
    request.send(file);
  });
}

function renderFiles(items, deletedItems = []) {
  fileList.replaceChildren();
  renderDeletedItems(deletedItems);

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Nothing yet.";
    fileList.append(empty);
    return;
  }

  for (const item of items) {
    if (item.kind === "link") {
      fileList.append(renderLink(item));
      continue;
    }

    if (item.kind === "text") {
      fileList.append(renderText(item));
      continue;
    }

    fileList.append(renderFile(item));
  }
}

function renderDeletedItems(items) {
  deletedList.replaceChildren();
  deletedSpace.hidden = items.length === 0;
  deletedCount.textContent = items.length ? `(${items.length})` : "";

  for (const item of items) {
    deletedList.append(renderDeletedItem(item));
  }
}

function renderFile(file) {
  const copy = document.createElement("button");
  copy.className = "icon-button";
  copy.type = "button";
  copy.setAttribute("aria-label", "Copy file link");
  copy.innerHTML = copyIconSvg();
  copy.addEventListener("click", () => copyLink(file.href));

  const remove = createIconButton("Delete", xIconSvg());
  remove.classList.add("danger-icon");
  remove.addEventListener("click", () => softDeleteItem(file));

  return renderCompactCard({
    item: file,
    cardClass: "item-file",
    titleClass: "file-name",
    title: file.name,
    meta: `${formatSize(file.size)} · ${formatDate(file.uploadedAt)}`,
    summary: "File",
    onOpen: () => openFilePreview(file),
    actions: [copy, remove]
  });
}

function openPreviewShell(title, bodyClass = "preview-body") {
  previewTitle.textContent = title || "Preview";
  previewBody.replaceChildren();
  previewBody.className = bodyClass;
  previewFooter.replaceChildren();
  previewOverlay.hidden = false;
  document.body.classList.add("is-previewing");
  previewPanel.focus?.();
}

async function openFilePreview(file) {
  openPreviewShell(file.name || "Preview");
  previewFooter.append(createCopyFileLinkButton(file), createDownloadLink(file), createDeleteButton(file));

  const previewHref = file.previewHref || file.href;
  const mimeType = file.mimeType || "";
  const kind = previewKind(mimeType, file.name || "");

  if (kind === "image") {
    const image = document.createElement("img");
    image.className = "preview-image";
    image.alt = file.name || "File preview";
    image.src = previewHref;
    previewBody.append(image);
    return;
  }

  if (kind === "text") {
    const pre = document.createElement("pre");
    pre.className = "preview-text";
    pre.textContent = "Loading.";
    previewBody.append(pre);

    try {
      const response = await fetch(previewHref, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Preview failed");
      }

      const text = await response.text();
      pre.textContent = text || "";
    } catch {
      pre.textContent = "Preview failed.";
    }

    return;
  }

  if (kind === "audio") {
    const audio = document.createElement("audio");
    audio.className = "preview-media";
    audio.controls = true;
    audio.src = previewHref;
    previewBody.append(audio);
    return;
  }

  if (kind === "video") {
    const video = document.createElement("video");
    video.className = "preview-video";
    video.controls = true;
    video.src = previewHref;
    previewBody.append(video);
    return;
  }

  const frame = document.createElement("iframe");
  frame.className = "preview-frame";
  frame.title = file.name || "File preview";
  frame.src = previewHref;
  frame.setAttribute("sandbox", "");
  previewBody.append(frame);
}

function closePreview() {
  previewOverlay.hidden = true;
  document.body.classList.remove("is-previewing");
  previewBody.replaceChildren();
  previewFooter.replaceChildren(previewDownload);
  previewDownload.removeAttribute("download");
  previewDownload.href = "#";
}

function previewKind(mimeType, name) {
  const cleanMime = mimeType.split(";")[0].trim().toLowerCase();
  const lowerName = name.toLowerCase();

  if (cleanMime.startsWith("image/")) {
    return "image";
  }

  if (cleanMime.startsWith("audio/")) {
    return "audio";
  }

  if (cleanMime.startsWith("video/")) {
    return "video";
  }

  if (
    cleanMime.startsWith("text/") ||
    [
      "application/json",
      "application/javascript",
      "application/xml",
      "application/x-ndjson",
      "image/svg+xml"
    ].includes(cleanMime) ||
    /\.(css|csv|js|json|log|md|markdown|txt|xml|yaml|yml)$/i.test(lowerName)
  ) {
    return "text";
  }

  return "frame";
}

function renderLink(link) {
  const copy = createIconButton("Copy link", copyIconSvg());
  copy.addEventListener("click", () => copyText(link.url));

  const remove = createIconButton("Delete", xIconSvg());
  remove.classList.add("danger-icon");
  remove.addEventListener("click", () => softDeleteItem(link));

  return renderCompactCard({
    item: link,
    cardClass: "item-link",
    titleClass: "link-title",
    title: link.label || link.url,
    meta: formatDate(link.uploadedAt),
    summary: link.url,
    onOpen: () => openLinkDetail(link),
    actions: [copy, remove]
  });
}

function renderText(textItem) {
  const copy = createIconButton("Copy text", copyIconSvg());
  copy.addEventListener("click", () => copyText(textItem.text || ""));

  const remove = createIconButton("Delete", xIconSvg());
  remove.classList.add("danger-icon");
  remove.addEventListener("click", () => softDeleteItem(textItem));

  return renderCompactCard({
    item: textItem,
    cardClass: "item-text",
    titleClass: "file-name",
    title: itemTitle(textItem),
    meta: formatDate(textItem.uploadedAt),
    summary: textItem.text || "Text",
    onOpen: () => openTextDetail(textItem),
    actions: [copy, remove]
  });
}

function renderCompactCard({ item, cardClass, titleClass, title, meta, summary, onOpen, actions }) {
  const card = document.createElement("li");
  card.className = `file-card compact-card ${cardClass}`;

  const summaryButton = document.createElement("button");
  summaryButton.className = "card-summary-button";
  summaryButton.type = "button";
  summaryButton.setAttribute("aria-label", `Open ${itemTitle(item)}`);
  summaryButton.addEventListener("click", onOpen);

  const titleNode = document.createElement("span");
  titleNode.className = titleClass;
  titleNode.textContent = title || itemTitle(item);

  const metaNode = document.createElement("span");
  metaNode.className = "file-meta";
  metaNode.textContent = meta;

  const summaryNode = document.createElement("span");
  summaryNode.className = "card-summary";
  summaryNode.textContent = summary || "";

  summaryButton.append(titleNode, metaNode, summaryNode);

  const controls = document.createElement("div");
  controls.className = "file-actions compact-actions";

  const open = document.createElement("button");
  open.className = "quiet-button";
  open.type = "button";
  open.textContent = "Open";
  open.addEventListener("click", onOpen);

  controls.append(open, ...actions);
  card.append(summaryButton, controls);
  return card;
}

function openLinkDetail(link) {
  openPreviewShell(itemTitle(link), "preview-body item-detail-body");

  const content = document.createElement("article");
  content.className = "detail-content";

  const anchor = document.createElement("a");
  anchor.className = "detail-url";
  anchor.href = link.url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = link.url;

  const meta = document.createElement("p");
  meta.className = "detail-meta";
  meta.textContent = formatDate(link.uploadedAt);

  content.append(anchor, meta);
  previewBody.append(content);
  previewFooter.append(createOpenLink(link), createCopyTextButton("Copy link", link.url), createDeleteButton(link));
}

function openTextDetail(textItem) {
  openPreviewShell(itemTitle(textItem), "preview-body item-detail-body");

  const content = document.createElement("article");
  content.className = "detail-content";

  const text = document.createElement("div");
  text.className = "detail-text";
  appendLinkifiedText(text, textItem.text || "");

  const meta = document.createElement("p");
  meta.className = "detail-meta";
  meta.textContent = formatDate(textItem.uploadedAt);

  content.append(text, meta);
  previewBody.append(content);
  previewFooter.append(createCopyTextButton("Copy text", textItem.text || ""), createDeleteButton(textItem));
}

function renderDeletedItem(deletedItem) {
  const item = document.createElement("li");
  item.className = `file-card deleted-card item-${deletedItem.kind || "file"}`;

  const main = document.createElement("div");
  main.className = "file-main";

  const title = document.createElement("span");
  title.className = deletedItem.kind === "link" ? "link-title" : "file-name";
  title.textContent = itemTitle(deletedItem);

  main.append(title);

  if (deletedItem.kind === "text") {
    const text = document.createElement("p");
    text.className = "text-blob deleted-snippet";
    text.textContent = deletedItem.text || "";
    main.append(text);
  }

  const meta = document.createElement("div");
  meta.className = "file-meta";
  meta.textContent = `Deleted ${formatDate(deletedItem.deletedAt)} · Clears ${formatDate(deletedItem.purgeAt)}`;
  main.append(meta);

  const actions = document.createElement("div");
  actions.className = "file-actions";

  const restore = document.createElement("button");
  restore.className = "quiet-button";
  restore.type = "button";
  restore.textContent = "Restore";
  restore.addEventListener("click", () => restoreItem(deletedItem));

  const remove = createIconButton("Delete forever", xIconSvg());
  remove.classList.add("danger-icon");
  remove.addEventListener("click", () => permanentlyDeleteItem(deletedItem));

  actions.append(restore, remove);
  item.append(main, actions);
  return item;
}

function appendLinkifiedText(node, value) {
  const pattern = /\b((?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"']*)?)/gi;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    const raw = match[0];
    const trailing = raw.match(/[),.!?:;]+$/)?.[0] || "";
    const clean = trailing ? raw.slice(0, -trailing.length) : raw;

    if (match.index > lastIndex) {
      node.append(document.createTextNode(value.slice(lastIndex, match.index)));
    }

    const anchor = document.createElement("a");
    anchor.href = normalizeHref(clean);
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = clean;
    node.append(anchor);

    if (trailing) {
      node.append(document.createTextNode(trailing));
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < value.length) {
    node.append(document.createTextNode(value.slice(lastIndex)));
  }
}

function normalizeHref(value) {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

function createIconButton(label, svg) {
  const button = document.createElement("button");
  button.className = "icon-button";
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.innerHTML = svg;
  return button;
}

function createDownloadLink(file) {
  const link = document.createElement("a");
  link.className = "download-link";
  link.href = file.href;
  link.textContent = "Download";
  link.setAttribute("download", file.name || "");
  return link;
}

function createOpenLink(linkItem) {
  const link = document.createElement("a");
  link.className = "download-link";
  link.href = linkItem.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Open link";
  return link;
}

function createCopyTextButton(label, value) {
  const button = createIconButton(label, copyIconSvg());
  button.addEventListener("click", () => copyText(value));
  return button;
}

function createCopyFileLinkButton(file) {
  const button = createIconButton("Copy file link", copyIconSvg());
  button.addEventListener("click", () => copyLink(file.href));
  return button;
}

function createDeleteButton(item) {
  const button = createIconButton("Delete", xIconSvg());
  button.classList.add("danger-icon");
  button.addEventListener("click", () => {
    closePreview();
    softDeleteItem(item);
  });
  return button;
}

function copyIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8h10v10H8z"></path>
      <path d="M6 14H4V4h10v2"></path>
    </svg>
  `;
}

function xIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12"></path>
      <path d="M18 6L6 18"></path>
    </svg>
  `;
}

async function softDeleteItem(item) {
  const confirmed = await askYaSure(`Move ${itemTitle(item)} to recently deleted?`);

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/items/${encodeURIComponent(item.id)}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      throw new Error("Delete failed");
    }

    await loadFiles();
    setStatus("Moved to recently deleted.");
  } catch {
    setStatus("Delete failed.");
  }
}

async function restoreItem(item) {
  try {
    const response = await fetch(`/api/items/${encodeURIComponent(item.id)}/restore`, {
      method: "POST"
    });

    if (!response.ok) {
      throw new Error("Restore failed");
    }

    await loadFiles();
    setStatus("Restored.");
  } catch {
    setStatus("Restore failed.");
  }
}

async function permanentlyDeleteItem(item) {
  const confirmed = await askYaSure(`Delete ${itemTitle(item)} for good?`);

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/items/${encodeURIComponent(item.id)}/permanent`, {
      method: "DELETE"
    });

    if (!response.ok) {
      throw new Error("Delete failed");
    }

    await loadFiles();
    setStatus("Deleted for good.");
  } catch {
    setStatus("Delete failed.");
  }
}

function askYaSure(detail) {
  confirmDetail.textContent = detail;
  confirmOverlay.hidden = false;
  document.body.classList.add("is-confirming");
  confirmPanel.focus();

  return new Promise((resolve) => {
    pendingConfirm = resolve;
  });
}

function settleConfirm(value) {
  if (!pendingConfirm) {
    return;
  }

  const resolve = pendingConfirm;
  pendingConfirm = null;
  confirmOverlay.hidden = true;
  document.body.classList.remove("is-confirming");
  confirmDetail.textContent = "";
  resolve(value);
}

function itemTitle(item) {
  if (item.kind === "link") {
    return item.label || item.url || "link";
  }

  if (item.kind === "text") {
    const compact = (item.text || "").replace(/\s+/g, " ").trim();
    return compact ? `"${compact.slice(0, 42)}${compact.length > 42 ? "..." : ""}"` : "text";
  }

  return item.name || "file";
}

async function copyLink(path) {
  const url = new URL(path, window.location.href).href;

  try {
    await navigator.clipboard.writeText(url);
    setStatus("Link copied.");
  } catch {
    setStatus(url);
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus("Copied.");
  } catch {
    setStatus("Could not copy.");
  }
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown size";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat([], {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function setStatus(message) {
  statusText.textContent = message;
}
