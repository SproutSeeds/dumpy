const fileInput = document.querySelector("#fileInput");
const folderInput = document.querySelector("#folderInput");
const chooseButton = document.querySelector("#chooseButton");
const chooseFolderButton = document.querySelector("#chooseFolderButton");
const dropZone = document.querySelector("#dropZone");
const fileList = document.querySelector("#fileList");
const itemListTitle = document.querySelector("#itemListTitle");
const statusText = document.querySelector("#statusText");
const progressBar = document.querySelector("#progressBar");
const dumpForm = document.querySelector("#dumpForm");
const dumpInput = document.querySelector("#dumpInput");
const partyForm = document.querySelector("#partyForm");
const partyName = document.querySelector("#partyName");
const createPartyButton = document.querySelector("#createPartyButton");
const partyCreateOverlay = document.querySelector("#partyCreateOverlay");
const partyCreateCancel = document.querySelector("#partyCreateCancel");
const partySection = document.querySelector("#partySection");
const partyList = document.querySelector("#partyList");
const partyCount = document.querySelector("#partyCount");
const partyToggle = document.querySelector("#partyToggle");
const activePartyLabel = document.querySelector("#activePartyLabel");
const clearPartyButton = document.querySelector("#clearPartyButton");
const storagePath = document.querySelector("#storagePath");
const dumpsToggle = document.querySelector("#dumpsToggle");
const screenshotFriend = document.querySelector("#screenshotFriend");
const screenshotFriendImage = document.querySelector("#screenshotFriendImage");
const screenshotFriendBubble = screenshotFriend?.querySelector(".screenshot-bubble");
const screenshotSection = document.querySelector("#screenshotSection");
const screenshotList = document.querySelector("#screenshotList");
const screenshotCount = document.querySelector("#screenshotCount");
const screenshotFolder = document.querySelector("#screenshotFolder");
const screenshotToggle = document.querySelector("#screenshotToggle");
const chooseScreenshotFolder = document.querySelector("#chooseScreenshotFolder");
const refreshScreenshots = document.querySelector("#refreshScreenshots");
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
const mascot = document.querySelector("#mascotButton");
const mascotImage = mascot?.querySelector(".mark");
const mascotBubble = document.querySelector(".bubble");

const mascotFaces = ["pinch", "brace", "clench", "whoa", "oops", "relief", "proud"];
const bashfulFaces = ["bashful-soft", "bashful-shy", "bashful-grin"];
const releaseFaces = ["relief", "proud", "whoa"];
const mascotIconVersion = "2";
const mascotIconFaces = new Set(["idle", ...mascotFaces, ...bashfulFaces, "poopy-dump"]);
const catchPhrases = [
  "Oopsie!",
  "Dump Duh dump dump.",
  "It's dumpin' time!",
  "awe shucks!",
  "Arrrrgh!!",
  "Narrggghh!",
  "HEEeeenenene!",
  "OOoooooffaaa!",
  "AYE!! Culo!"
];
const bashfulPhrases = ["awe shucks!", "Oopsie!", "HEEeeenenene!"];
const poopyPhrases = ["Arrrrgh!!", "Narrggghh!", "OOoooooffaaa!", "AYE!! Culo!"];
const collapseStorageKeys = {
  dumps: "dumpy:collapse:dumps",
  parties: "dumpy:collapse:parties",
  screenshots: "dumpy:collapse:screenshots"
};

let refreshTimer = window.setInterval(loadFiles, 8000);
let pendingConfirm = null;
let lastMascotFace = "idle";
let lastMascotPhrase = "Oopsie!";
let mascotFaceTimer = 0;
let mascotClickCount = 0;
let bashfulFaceIndex = 0;
let allItems = [];
let allParties = [];
let allScreenshots = [];
let screenshotMeta = {
  enabled: true,
  folder: ""
};
let deletedItemsCache = [];
let deletedPartiesCache = [];
let activePartyId = null;
let dumpsCollapsed = readCollapsedState(collapseStorageKeys.dumps);
let partiesCollapsed = readCollapsedState(collapseStorageKeys.parties);
let screenshotsCollapsed = readCollapsedState(collapseStorageKeys.screenshots);
let screenshotSpaceActive = window.location.hash === "#screenshots";

preloadMascotIcons();
renderAppSpace();

chooseButton.addEventListener("click", () => {
  triggerMascotFace();
  fileInput.click();
});
chooseFolderButton.addEventListener("click", () => {
  triggerMascotFace();
  folderInput.click();
});
mascot.addEventListener("click", () => {
  if (!screenshotSpaceActive) {
    handleMascotClick();
    return;
  }

  enterDumpySpace({ pushHistory: screenshotSpaceActive });
});
dumpForm.addEventListener("submit", dumpText);
partyForm.addEventListener("submit", createParty);
createPartyButton.addEventListener("click", openPartyCreator);
partyCreateCancel.addEventListener("click", closePartyCreator);
partyCreateOverlay.addEventListener("click", (event) => {
  if (event.target === partyCreateOverlay) {
    closePartyCreator();
  }
});
clearPartyButton.addEventListener("click", () => {
  setActiveParty(null);
});
partyToggle.addEventListener("click", () => {
  partiesCollapsed = !partiesCollapsed;
  writeCollapsedState(collapseStorageKeys.parties, partiesCollapsed);
  renderCollapseState();
});
dumpsToggle.addEventListener("click", () => {
  dumpsCollapsed = !dumpsCollapsed;
  writeCollapsedState(collapseStorageKeys.dumps, dumpsCollapsed);
  renderCollapseState();
});
screenshotToggle.addEventListener("click", () => {
  screenshotsCollapsed = !screenshotsCollapsed;
  writeCollapsedState(collapseStorageKeys.screenshots, screenshotsCollapsed);
  renderScreenshots();
});
screenshotFriend.addEventListener("click", () => {
  enterScreenshotSpace({ pushHistory: true });
});
chooseScreenshotFolder.addEventListener("click", chooseScreenshotFolderFromHost);
refreshScreenshots.addEventListener("click", loadScreenshots);
previewClose.addEventListener("click", () => {
  goBackOneStep();
});
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
  if (event.key === "Escape") {
    event.preventDefault();
    goBackOneStep();
  }
});
dumpInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    dumpForm.requestSubmit();
  }
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) {
    triggerMascotFace();
  }
  uploadFiles(fileInput.files);
  fileInput.value = "";
});

folderInput.addEventListener("change", () => {
  if (folderInput.files.length) {
    triggerMascotFace();
  }
  uploadFiles(folderInput.files);
  folderInput.value = "";
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  if (event.dataTransfer.files.length || event.dataTransfer.items.length) {
    triggerMascotFace();
  }
  uploadFiles(await filesFromDrop(event.dataTransfer));
});

window.addEventListener("focus", loadFiles);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadFiles();
  }
});
window.addEventListener("popstate", () => {
  if (window.location.hash === "#screenshots") {
    enterScreenshotSpace({ pushHistory: false });
    return;
  }

  enterDumpySpace({ pushHistory: false });
});

await loadFiles();

async function loadFiles() {
  try {
    const response = await fetch("/api/files", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("List failed");
    }

    const payload = await response.json();
    allItems = payload.items || payload.files || [];
    allParties = payload.parties || [];
    deletedItemsCache = payload.deletedItems || [];
    deletedPartiesCache = payload.deletedParties || [];
    renderStorage(payload.storage);
    await loadScreenshots();

    if (activePartyId && !allParties.some((party) => party.id === activePartyId)) {
      activePartyId = null;
    }

    renderFiles();
    const visibleItems = itemsForActiveParty();
    setStatus(visibleItems.length ? `${visibleItems.length} item${visibleItems.length === 1 ? "" : "s"}.` : "Ready.");
  } catch {
    setStatus("Dumpy is private. Open Tailscale and make sure you are connected, then try again.");
  }
}

async function loadScreenshots() {
  try {
    const response = await fetch("/api/screenshots", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Screenshot list failed");
    }

    const payload = await response.json();
    allScreenshots = payload.screenshots || [];
    screenshotMeta = payload;
    renderScreenshots();
  } catch {
    allScreenshots = [];
    screenshotMeta = {
      enabled: true,
      folder: "",
      error: "Screenshots could not load."
    };
    renderScreenshots();
  }
}

async function chooseScreenshotFolderFromHost() {
  if (!screenshotMeta.canChooseFolder) {
    setStatus("Screenshot folder is set outside Dumpy.");
    return;
  }

  chooseScreenshotFolder.disabled = true;
  chooseScreenshotFolder.textContent = "Choosing.";

  try {
    const response = await fetch("/api/screenshots/folder", {
      method: "POST"
    });

    if (!response.ok) {
      throw new Error("Folder choice failed");
    }

    const payload = await response.json();
    allScreenshots = payload.screenshots || [];
    screenshotMeta = payload;
    renderScreenshots();
    setStatus("Screenshot folder updated.");
  } catch {
    setStatus("Folder choice failed.");
  } finally {
    chooseScreenshotFolder.disabled = false;
    chooseScreenshotFolder.textContent = "Choose folder";
  }
}

function enterScreenshotSpace({ pushHistory = false } = {}) {
  screenshotSpaceActive = true;
  screenshotsCollapsed = false;

  if (pushHistory && window.location.hash !== "#screenshots") {
    window.history.pushState({ space: "screenshots" }, "", "#screenshots");
  }

  renderAppSpace();
  renderScreenshots();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function enterDumpySpace({ pushHistory = false } = {}) {
  screenshotSpaceActive = false;

  if (pushHistory && window.location.hash) {
    window.history.pushState({ space: "dumpy" }, "", `${window.location.pathname}${window.location.search}`);
  } else if (!pushHistory) {
    clearHashIfNeeded();
  }

  renderAppSpace();
  renderScreenshots();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAppSpace() {
  document.body.classList.toggle("is-screenshot-space", screenshotSpaceActive);
  mascot?.classList.toggle("is-active", !screenshotSpaceActive);
  screenshotFriend?.classList.toggle("is-active", screenshotSpaceActive);
  mascot?.setAttribute("aria-pressed", String(!screenshotSpaceActive));
  screenshotFriend?.setAttribute("aria-pressed", String(screenshotSpaceActive));
}

function goBackOneStep() {
  if (!previewOverlay.hidden) {
    closePreview();
    return true;
  }

  if (!confirmOverlay.hidden) {
    settleConfirm(false);
    return true;
  }

  if (!partyCreateOverlay.hidden) {
    closePartyCreator();
    return true;
  }

  if (screenshotSpaceActive) {
    enterDumpySpace({ pushHistory: false });
    return true;
  }

  if (activePartyId) {
    setActiveParty(null);
    return true;
  }

  if (window.history.length > 1) {
    window.history.back();
    return true;
  }

  return false;
}

function clearHashIfNeeded() {
  if (window.location.hash) {
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
  }
}

async function createParty(event) {
  event.preventDefault();
  const name = partyName.value.trim();

  if (!name) {
    partyName.focus();
    return;
  }

  try {
    const response = await fetch("/api/parties", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      throw new Error("Party failed");
    }

    const payload = await response.json();
    closePartyCreator({ restoreFocus: false });
    await loadFiles();
    setActiveParty(payload.party?.id || null);
    setStatus("Party started.");
  } catch {
    setStatus("Party failed.");
  }
}

function openPartyCreator() {
  partyName.value = "";
  partyCreateOverlay.hidden = false;
  document.body.classList.add("is-creating-party");
  partyName.focus();
}

function closePartyCreator({ restoreFocus = true } = {}) {
  partyCreateOverlay.hidden = true;
  document.body.classList.remove("is-creating-party");
  partyName.value = "";

  if (restoreFocus) {
    createPartyButton.focus();
  }
}

async function dumpText(event) {
  event.preventDefault();

  const content = dumpInput.value.trim();

  if (!content) {
    dumpInput.focus();
    return;
  }

  triggerMascotFace();

  try {
    setStatus("Dumping.");
    const response = await fetch("/api/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content, partyId: activePartyId })
    });

    if (!response.ok) {
      throw new Error("Dump failed");
    }

    dumpInput.value = "";
    await loadFiles();
    setStatus("Dropped.");
    triggerMascotFace(releaseFaces);
  } catch {
    setStatus("Dump failed.");
  }
}

async function uploadFiles(fileBag) {
  const files = normalizeUploadEntries(fileBag);

  if (!files.length) {
    return;
  }

  window.clearInterval(refreshTimer);
  progressBar.style.width = "0";

  try {
    for (let index = 0; index < files.length; index += 1) {
      const { file, relativePath } = files[index];
      setStatus(`Uploading ${file.name || "untitled"} (${index + 1}/${files.length})`);
      await uploadFile(file, relativePath);
    }

    progressBar.style.width = "100%";
    setStatus("Dropped.");
    await loadFiles();
    triggerMascotFace(releaseFaces);
  } catch {
    setStatus("Upload failed.");
  } finally {
    window.setTimeout(() => {
      progressBar.style.width = "0";
    }, 700);
    refreshTimer = window.setInterval(loadFiles, 8000);
  }
}

function uploadFile(file, relativePath = "") {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const params = new URLSearchParams({
      name: file.name || "untitled"
    });

    if (activePartyId) {
      params.set("partyId", activePartyId);
    }

    if (relativePath) {
      params.set("relativePath", relativePath);
    }

    request.open("POST", `/api/files?${params.toString()}`);
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

function normalizeUploadEntries(fileBag) {
  return Array.from(fileBag || [])
    .map((entry) => {
      if (entry?.file instanceof File) {
        return {
          file: entry.file,
          relativePath: entry.relativePath || entry.file.webkitRelativePath || ""
        };
      }

      return {
        file: entry,
        relativePath: entry?.webkitRelativePath || ""
      };
    })
    .filter((entry) => entry.file instanceof File);
}

async function filesFromDrop(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);

  if (!entries.length) {
    return dataTransfer?.files || [];
  }

  const files = [];

  for (const entry of entries) {
    files.push(...(await filesFromEntry(entry)));
  }

  return files;
}

async function filesFromEntry(entry, parentPath = "") {
  if (!entry) {
    return [];
  }

  const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ file, relativePath: entryPath }];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const reader = entry.createReader();
  const children = [];

  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));

    if (!batch.length) {
      break;
    }

    children.push(...batch);
  }

  const files = [];

  for (const child of children) {
    files.push(...(await filesFromEntry(child, entryPath)));
  }

  return files;
}

function triggerMascotFace(pool = mascotFaces, phrasePool = catchPhrases) {
  if (!mascot) {
    return;
  }

  const faces = typeof pool === "string" ? [pool] : Array.isArray(pool) ? pool : mascotFaces;
  const availableFaces = faces.filter((face) => face !== lastMascotFace);
  const choices = availableFaces.length ? availableFaces : faces;
  const nextFace = choices[Math.floor(Math.random() * choices.length)] || "pinch";

  window.clearTimeout(mascotFaceTimer);
  lastMascotFace = nextFace;
  mascot.dataset.face = nextFace;
  setMascotIcon(nextFace);
  updateMascotPhrase(phrasePool);
  mascot.classList.remove("is-reacting");
  void mascot.offsetWidth;
  mascot.classList.add("is-reacting");

  mascotFaceTimer = window.setTimeout(() => {
    mascot.classList.remove("is-reacting");
  }, 700);
}

function updateMascotPhrase(pool = catchPhrases) {
  if (!mascotBubble) {
    return;
  }

  const phrases = typeof pool === "string" ? [pool] : Array.isArray(pool) ? pool : catchPhrases;
  const availablePhrases = phrases.filter((phrase) => phrase !== lastMascotPhrase);
  const choices = availablePhrases.length ? availablePhrases : phrases;
  const nextPhrase = choices[Math.floor(Math.random() * choices.length)] || "Oopsie!";

  lastMascotPhrase = nextPhrase;
  mascotBubble.textContent = nextPhrase;
  mascotBubble.classList.remove("is-talking");
  void mascotBubble.offsetWidth;
  mascotBubble.classList.add("is-talking");
}

function handleMascotClick() {
  mascotClickCount += 1;

  if (mascotClickCount % 2 === 0) {
    triggerMascotFace("poopy-dump", poopyPhrases);
  } else {
    const bashfulFace = bashfulFaces[bashfulFaceIndex % bashfulFaces.length];
    bashfulFaceIndex += 1;
    triggerMascotFace(bashfulFace, bashfulPhrases);
  }

  loadFiles();
}

function setMascotIcon(face) {
  if (!mascotImage) {
    return;
  }

  const safeFace = mascotIconFaces.has(face) ? face : "idle";
  const nextSrc = mascotIconSrc(safeFace);

  if (mascotImage.getAttribute("src") !== nextSrc) {
    mascotImage.setAttribute("src", nextSrc);
  }
}

function mascotIconSrc(face) {
  return `/mascots/dumpy-${face}.svg?v=${mascotIconVersion}`;
}

function preloadMascotIcons() {
  for (const face of mascotIconFaces) {
    const image = new Image();
    image.decoding = "async";
    image.src = mascotIconSrc(face);
  }
}

function renderFiles() {
  const items = itemsForActiveParty();
  const activeParty = partyById(activePartyId);

  fileList.replaceChildren();
  renderParties();
  renderDeletedItems([...deletedItemsCache, ...deletedPartiesCache]);
  activePartyLabel.textContent = activeParty?.name || "Loose Dumps";
  clearPartyButton.hidden = !activePartyId;
  itemListTitle.textContent = activeParty ? `${activeParty.name} Dumps` : "Loose Dumps";
  renderCollapseState();

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = activeParty ? "Nothing in this party yet." : "Nothing yet.";
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

function itemsForActiveParty() {
  return allItems.filter((item) => (activePartyId ? item.partyId === activePartyId : !item.partyId));
}

function partyById(id) {
  return allParties.find((party) => party.id === id) || null;
}

function setActiveParty(id) {
  activePartyId = id && partyById(id) ? id : null;
  renderFiles();
}

function renderParties() {
  partyList.replaceChildren();
  partySection.hidden = false;
  partyCount.textContent = allParties.length ? `(${allParties.length})` : "";
  renderCollapseState();

  for (const party of allParties) {
    partyList.append(renderParty(party));
  }
}

function renderCollapseState() {
  partyList.hidden = partiesCollapsed;
  renderSectionToggle(partyToggle, partiesCollapsed, "dump parties");

  fileList.hidden = dumpsCollapsed;
  renderSectionToggle(dumpsToggle, dumpsCollapsed, activePartyId ? "party dumps" : "loose dumps");
}

function renderScreenshots() {
  if (!screenshotSection) {
    return;
  }

  const enabled = screenshotMeta.enabled !== false;
  screenshotSection.hidden = !enabled || !screenshotSpaceActive;
  screenshotFriend.hidden = !enabled;

  if (!enabled) {
    return;
  }

  screenshotList.replaceChildren();
  screenshotList.hidden = screenshotSpaceActive ? false : screenshotsCollapsed;
  screenshotCount.textContent = allScreenshots.length ? `(${allScreenshots.length})` : "";
  renderSectionToggle(screenshotToggle, screenshotSpaceActive ? false : screenshotsCollapsed, "screenshots");
  updateScreenshotFriend();
  chooseScreenshotFolder.hidden = !screenshotMeta.canChooseFolder;
  chooseScreenshotFolder.disabled = !screenshotMeta.canChooseFolder;

  if (screenshotMeta.error) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = screenshotMeta.error;
    screenshotList.append(empty);
    screenshotFolder.textContent = "Screenshot folder unavailable.";
    return;
  }

  screenshotFolder.textContent = screenshotMeta.folder
    ? `${screenshotMeta.folder}${screenshotMeta.source === "setting" ? "" : ` (${screenshotMeta.source})`}`
    : "Most recent first.";

  if (!allScreenshots.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Take a screenshot and it will land here.";
    screenshotList.append(empty);
    return;
  }

  for (const screenshot of allScreenshots) {
    screenshotList.append(renderScreenshot(screenshot));
  }
}

function updateScreenshotFriend() {
  if (!screenshotFriendImage) {
    return;
  }

  const latest = allScreenshots[0] || null;
  screenshotFriend.classList.toggle("has-screenshot", Boolean(latest));
  screenshotFriendImage.src = latest?.previewHref || "/mascots/dumpy-whoa.svg?v=2";
  screenshotFriendImage.alt = "";

  if (screenshotFriendBubble) {
    screenshotFriendBubble.textContent = latest ? "Look at me, Dumpy" : "Screenshots go here";
  }
}

function renderScreenshot(screenshot) {
  const card = document.createElement("li");
  card.className = "file-card compact-card screenshot-card";
  card.draggable = true;
  card.title = "Drag this screenshot into another app or page.";
  card.addEventListener("dragstart", (event) => startScreenshotDrag(event, screenshot));

  const summaryButton = document.createElement("button");
  summaryButton.className = "screenshot-summary-button";
  summaryButton.type = "button";
  summaryButton.setAttribute("aria-label", `Open ${screenshot.name}`);
  summaryButton.addEventListener("click", () => openFilePreview(screenshot));

  const thumb = document.createElement("span");
  thumb.className = "screenshot-thumb";

  const image = document.createElement("img");
  image.className = "screenshot-thumb-image";
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.src = screenshot.previewHref || screenshot.href;
  thumb.append(image);

  const details = document.createElement("span");
  details.className = "screenshot-details";

  const title = document.createElement("span");
  title.className = "file-name";
  title.textContent = screenshot.name;

  const meta = document.createElement("span");
  meta.className = "file-meta";
  meta.textContent = `${formatSize(screenshot.size)} · ${formatDate(screenshot.uploadedAt)}`;

  details.append(title, meta);
  summaryButton.append(thumb, details);

  const actions = document.createElement("div");
  actions.className = "file-actions compact-actions";

  const open = document.createElement("button");
  open.className = "quiet-button";
  open.type = "button";
  open.textContent = "Open";
  open.addEventListener("click", () => openFilePreview(screenshot));

  actions.append(open, createCopyImageButton(screenshot));

  if (screenshotMeta.canReveal) {
    actions.append(createRevealButton(screenshot));
  }

  actions.append(createDownloadLink(screenshot));
  card.append(summaryButton, actions);
  return card;
}

function startScreenshotDrag(event, screenshot) {
  const url = absoluteUrl(screenshot.href);
  const previewUrl = absoluteUrl(screenshot.previewHref || screenshot.href);

  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/uri-list", url);
  event.dataTransfer.setData("text/plain", url);
  event.dataTransfer.setData("text/html", `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(screenshot.name || "Screenshot")}">`);
}

function renderSectionToggle(button, collapsed, label) {
  button.classList.toggle("is-collapsed", collapsed);
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${label}`);
  button.title = `${collapsed ? "Expand" : "Collapse"} ${label}`;
}

function renderParty(party) {
  const isActive = party.id === activePartyId;
  const card = document.createElement("li");
  card.className = `file-card compact-card party-card${isActive ? " is-active" : ""}`;

  const summaryButton = document.createElement("button");
  summaryButton.className = "card-summary-button";
  summaryButton.type = "button";
  summaryButton.setAttribute("aria-label", `Use ${party.name}`);
  summaryButton.addEventListener("click", () => setActiveParty(party.id));

  const title = document.createElement("span");
  title.className = "file-name";
  title.textContent = party.name;

  const meta = document.createElement("span");
  meta.className = "file-meta";
  meta.textContent = `${party.itemCount || 0} dump${party.itemCount === 1 ? "" : "s"} · ${formatDate(party.createdAt)}`;

  const summary = document.createElement("span");
  summary.className = "card-summary";
  summary.textContent = isActive ? "Dump box is aimed here." : "Click to aim the dump box here.";

  summaryButton.append(title, meta, summary);

  const actions = document.createElement("div");
  actions.className = "file-actions compact-actions";

  const use = document.createElement("button");
  use.className = "quiet-button";
  use.type = "button";
  use.textContent = isActive ? "Using" : "Use";
  use.addEventListener("click", () => setActiveParty(party.id));

  const download = document.createElement("a");
  download.className = "download-link";
  download.href = `/api/parties/${encodeURIComponent(party.id)}/download`;
  download.textContent = "Zip";
  download.setAttribute("download", `${party.name || "dump-party"}.zip`);

  const remove = createIconButton("Delete party", xIconSvg());
  remove.classList.add("danger-icon");
  remove.addEventListener("click", () => softDeleteParty(party));

  actions.append(use, download, remove);
  card.append(summaryButton, actions);
  return card;
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
    summary: file.relativePath || "File",
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
  previewFooter.append(createCopyFileLinkButton(file), createDownloadLink(file));

  if (file.kind === "screenshot") {
    previewFooter.prepend(createCopyImageButton(file));

    if (screenshotMeta.canReveal) {
      previewFooter.append(createRevealButton(file));
    }
  } else {
    previewFooter.append(createDeleteButton(file));
  }

  const previewHref = file.previewHref || file.href;
  const mimeType = file.mimeType || "";
  const kind = previewKind(mimeType, file.name || "");

  if (kind === "image") {
    previewBody.classList.add("preview-image-body");
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
  const chrome = createChromeButton(link);

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
    actions: [chrome, copy, remove]
  });
}

function renderText(textItem) {
  const firstLink = firstLinkInText(textItem.text || "");
  const actions = [];
  if (firstLink) {
    actions.push(createChromeButton(homeScreenTargetForUrl(firstLink)));
  }

  const copy = createIconButton("Copy text", copyIconSvg());
  copy.addEventListener("click", () => copyText(textItem.text || ""));
  actions.push(copy);

  const remove = createIconButton("Delete", xIconSvg());
  remove.classList.add("danger-icon");
  remove.addEventListener("click", () => softDeleteItem(textItem));
  actions.push(remove);

  return renderCompactCard({
    item: textItem,
    cardClass: "item-text",
    titleClass: "file-name",
    title: itemTitle(textItem),
    meta: formatDate(textItem.uploadedAt),
    summary: textItem.text || "Text",
    onOpen: () => openTextDetail(textItem),
    actions
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
  meta.textContent = detailMeta(link);

  content.append(anchor, meta);
  previewBody.append(content);
  previewFooter.append(createChromeButton(link), createOpenLink(link), createCopyTextButton("Copy link", link.url), createDeleteButton(link));
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
  meta.textContent = detailMeta(textItem);

  content.append(text, meta);
  previewBody.append(content);
  const firstLink = firstLinkInText(textItem.text || "");
  if (firstLink) {
    previewFooter.append(createChromeButton(homeScreenTargetForUrl(firstLink)));
  }
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

async function softDeleteParty(party) {
  const confirmed = await askYaSure(`Move ${party.name} and its dumps to recently deleted?`);

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/parties/${encodeURIComponent(party.id)}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      throw new Error("Delete failed");
    }

    if (activePartyId === party.id) {
      activePartyId = null;
    }

    await loadFiles();
    setStatus("Party moved to recently deleted.");
  } catch {
    setStatus("Delete failed.");
  }
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

function firstLinkInText(value) {
  const match = String(value || "").match(/\b((?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"']*)?)/i);
  if (!match) return "";
  const raw = match[1] || match[0];
  const trailing = raw.match(/[),.!?:;]+$/)?.[0] || "";
  const clean = trailing ? raw.slice(0, -trailing.length) : raw;
  return normalizeHref(clean);
}

function homeScreenTargetForUrl(url) {
  return {
    kind: "link",
    label: labelForHref(url),
    url
  };
}

function labelForHref(value) {
  try {
    const url = new URL(normalizeHref(value));
    const pathLabel = url.pathname === "/" ? "" : url.pathname;
    return `${url.hostname}${pathLabel}`.slice(0, 220);
  } catch {
    return "Saved link";
  }
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

function createChromeButton(linkItem) {
  const url = firstLinkInText(linkItem.url || "") || normalizeHref(linkItem.url || "");
  const link = document.createElement("a");
  link.className = "quiet-button home-screen-button";
  link.href = chromeHrefForUrl(url);
  link.rel = "noreferrer";
  link.textContent = "Browser";
  link.setAttribute("aria-label", "Open this link in Chrome");

  link.addEventListener("click", async () => {
    try {
      await navigator.clipboard?.writeText(url);
      setStatus("Opening Chrome. Link copied.");
    } catch {
      setStatus("Opening Chrome.");
    }
  });

  return link;
}

function chromeHrefForUrl(value) {
  try {
    const url = new URL(normalizeHref(value));
    const rest = `${url.host}${url.pathname}${url.search}${url.hash}`;

    if (url.protocol === "https:") {
      return `googlechromes://${rest}`;
    }

    if (url.protocol === "http:") {
      return `googlechrome://${rest}`;
    }
  } catch {
    return value;
  }

  return value;
}

function createCopyTextButton(label, value) {
  const button = createIconButton(label, copyIconSvg());
  button.addEventListener("click", () => copyText(value));
  return button;
}

function createCopyImageButton(screenshot) {
  const button = createIconButton("Copy image", copyIconSvg());
  button.addEventListener("click", () => copyScreenshotImage(screenshot));
  return button;
}

function createRevealButton(screenshot) {
  const button = createIconButton("Reveal in Finder", folderIconSvg());
  button.addEventListener("click", () => revealScreenshot(screenshot));
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

function folderIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h6l2 3h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <path d="M3 10h18"></path>
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
  const route = item.kind === "party" ? "parties" : "items";

  try {
    const response = await fetch(`/api/${route}/${encodeURIComponent(item.id)}/restore`, {
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

  const route = item.kind === "party" ? "parties" : "items";

  try {
    const response = await fetch(`/api/${route}/${encodeURIComponent(item.id)}/permanent`, {
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
  if (item.kind === "party") {
    return item.name || "Dump Party";
  }

  if (item.kind === "link") {
    return item.label || item.url || "link";
  }

  if (item.kind === "text") {
    const compact = (item.text || "").replace(/\s+/g, " ").trim();
    return compact ? `"${compact.slice(0, 42)}${compact.length > 42 ? "..." : ""}"` : "text";
  }

  return item.name || "file";
}

function detailMeta(item) {
  const parts = [formatDate(item.uploadedAt)];

  if (item.relativePath) {
    parts.push(item.relativePath);
  }

  const party = partyById(item.partyId);

  if (party) {
    parts.push(party.name);
  }

  return parts.join(" · ");
}

function renderStorage(storage) {
  if (!storagePath || !storage) {
    return;
  }

  const source = storage.source === "default" ? "default" : storage.source;
  storagePath.textContent = `Storage: ${storage.dataDir || "Unknown"} (${source})`;
}

function readCollapsedState(key) {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeCollapsedState(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore private browsing/storage-denied modes.
  }
}

async function copyLink(path) {
  const url = absoluteUrl(path);

  try {
    await navigator.clipboard.writeText(url);
    setStatus("Link copied.");
  } catch {
    setStatus(url);
  }
}

async function copyScreenshotImage(screenshot) {
  try {
    if (!window.ClipboardItem || !navigator.clipboard?.write) {
      await copyLink(screenshot.href);
      return;
    }

    const response = await fetch(screenshot.previewHref || screenshot.href, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Image fetch failed");
    }

    const blob = await response.blob();
    const type = blob.type || screenshot.mimeType || "image/png";
    await navigator.clipboard.write([
      new ClipboardItem({
        [type]: blob
      })
    ]);
    setStatus("Screenshot copied.");
  } catch {
    await copyLink(screenshot.href);
  }
}

async function revealScreenshot(screenshot) {
  try {
    const response = await fetch(`/api/screenshots/${encodeURIComponent(screenshot.id)}/reveal`, {
      method: "POST"
    });

    if (!response.ok) {
      throw new Error("Reveal failed");
    }

    setStatus("Revealed in Finder.");
  } catch {
    setStatus("Could not reveal screenshot.");
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

function absoluteUrl(path) {
  return new URL(path, window.location.href).href;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
