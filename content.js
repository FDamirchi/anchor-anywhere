// Anchor Anywhere (MVP)
// Shortcuts:
//   Alt + A -> create anchor from selection
//   Alt + X -> clear anchors for this page

const storageKey = () => `aa:anchors:${location.href}`;

function loadAnchors() {
    try {
        return JSON.parse(localStorage.getItem(storageKey()) || "[]");
    } catch {
        return [];
    }
}

function saveAnchors(list) {
    localStorage.setItem(storageKey(), JSON.stringify(list));
}

function makeId() {
    return "aa_" + crypto.randomUUID();
}

function textPreviewNear(marker) {
    const text = marker.parentElement?.innerText?.trim() || "Anchor";
    return text.replace(/\s+/g, " ").slice(0, 60);
}

function flash(el) {
    const prev = el.style.outline;
    el.style.outline = "2px solid orange";
    setTimeout(() => (el.style.outline = prev || ""), 600);
}

function createMarkerAtSelectionStart() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;

    const marker = document.createElement("span");
    marker.id = makeId();
    marker.setAttribute("data-anchor-anywhere", "1");
    marker.style.cssText =
        "display:inline-block;width:0;height:0;line-height:0;";

    // Insert a zero-size marker at the start of the selection.
    range.collapse(true);
    range.insertNode(marker);

    // Clear selection to avoid weird UX on some pages.
    sel.removeAllRanges();

    return marker;
}

function addAnchorFromSelection() {
    const marker = createMarkerAtSelectionStart();
    if (!marker) return;

    const anchors = loadAnchors();
    anchors.push({
        id: marker.id,
        title: textPreviewNear(marker),
        createdAt: Date.now(),
    });
    saveAnchors(anchors);

    flash(marker);
    renderPanel();
}

function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) {
        window.alert(
            "Anchor not found. The page may have re-rendered or removed that element."
        );
        return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    flash(el);
}

function clearAnchors() {
    saveAnchors([]);
    renderPanel();
}

function removeAnchor(id) {
    const next = loadAnchors().filter((a) => a.id !== id);
    saveAnchors(next);

    // Best-effort cleanup: remove marker if it's still in DOM.
    const el = document.getElementById(id);
    if (el) el.remove();

    renderPanel();
}

function ensurePanel() {
    let panel = document.getElementById("anchor-panel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "anchor-panel";
    document.body.appendChild(panel);
    return panel;
}

function renderPanel() {
    const panel = ensurePanel();
    const anchors = loadAnchors();

    panel.innerHTML = `
    <div class="title">
      <span>Anchors</span>
      <span style="opacity:.8">Alt+A</span>
    </div>
    <div class="row">
      <button id="aa-clear" type="button">Clear (Alt+X)</button>
      <button id="aa-hide" type="button">Hide</button>
    </div>
    <div id="aa-list" style="margin-top:8px;"></div>
    <div class="hint">Select text → Alt+A</div>
  `;

    panel.querySelector("#aa-clear").onclick = clearAnchors;
    panel.querySelector("#aa-hide").onclick = () =>
        (panel.style.display = "none");

    const list = panel.querySelector("#aa-list");
    if (!anchors.length) {
        list.innerHTML = `<div style="opacity:.8;margin-top:6px;">No anchors yet.</div>`;
        return;
    }

    anchors
        .slice()
        .reverse()
        .forEach((a) => {
            const row = document.createElement("div");
            row.style.cssText =
                "margin:6px 0;display:flex;gap:6px;align-items:center;";

            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = a.title || a.id;
            btn.style.flex = "1";
            btn.onclick = () => jumpTo(a.id);

            const del = document.createElement("button");
            del.type = "button";
            del.textContent = "✕";
            del.style.width = "40px";
            del.onclick = () => removeAnchor(a.id);

            row.appendChild(btn);
            row.appendChild(del);
            list.appendChild(row);
        });
}

document.addEventListener("keydown", (e) => {
    if (!e.altKey) return;

    const key = e.key.toLowerCase();
    if (key === "a") {
        e.preventDefault();
        addAnchorFromSelection();
    } else if (key === "x") {
        e.preventDefault();
        clearAnchors();
    }
});

renderPanel();
