// Anchor Anywhere (v0.1)
// Fixes:
// - Lightweight selection caching (no expensive container scanning on selectionchange)
// - Capture selection on right-click (mousedown button=2) + contextmenu
// - Container detection: ancestor-only (fast). Window fallback covers Wikipedia.
// - Smooth scrolling where possible.

const PANEL_ID = "aa-panel";

// Cached selection snapshot (short TTL)
let lastSelection = null;
let lastSelectionAt = 0;
const SELECTION_TTL_MS = 8000;

function isTopFrame() {
    return window.top === window;
}

function topPageKey() {
    try {
        return `aa:pins:${window.top.location.origin}${window.top.location.pathname}`;
    } catch {
        return `aa:pins:${location.origin}${location.pathname}`;
    }
}

async function getPins() {
    const key = topPageKey();
    const obj = await chrome.storage.local.get(key);
    return obj[key] || [];
}

async function setPins(pins) {
    const key = topPageKey();
    await chrome.storage.local.set({ [key]: pins });
}

function overflowY(el) {
    try {
        return getComputedStyle(el).overflowY;
    } catch {
        return "";
    }
}

function isScrollable(el) {
    if (!el || el === document.documentElement || el === document.body)
        return false;
    const oy = overflowY(el);
    if (!(oy === "auto" || oy === "scroll" || oy === "overlay")) return false;
    return el.scrollHeight > el.clientHeight + 4;
}

function pickClassTokens(el) {
    const cls =
        el.className && typeof el.className === "string" ? el.className : "";
    const tokens = cls.split(/\s+/).filter(Boolean);
    return tokens.slice(0, 2);
}

function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts = [];
    let cur = el;
    let depth = 0;

    while (cur && cur.nodeType === 1 && cur !== document.body && depth < 6) {
        let part = cur.tagName.toLowerCase();

        const dt = cur.getAttribute("data-testid");
        const aria = cur.getAttribute("aria-label");
        const role = cur.getAttribute("role");

        if (dt) part += `[data-testid="${CSS.escape(dt)}"]`;
        else if (aria) part += `[aria-label="${CSS.escape(aria)}"]`;
        else if (role) part += `[role="${CSS.escape(role)}"]`;

        const ct = pickClassTokens(cur);
        if (ct.length) part += ct.map((c) => `.${CSS.escape(c)}`).join("");

        const parent = cur.parentElement;
        if (parent) {
            const same = Array.from(parent.children).filter(
                (c) => c.tagName === cur.tagName
            );
            if (same.length > 1) {
                const idx = same.indexOf(cur) + 1;
                part += `:nth-of-type(${idx})`;
            }
        }

        parts.unshift(part);
        cur = cur.parentElement;
        depth += 1;
    }

    return parts.length ? parts.join(" > ") : null;
}

function containerHint(el) {
    if (!el || el.nodeType !== 1) return null;
    return {
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute("data-testid") || null,
        aria: el.getAttribute("aria-label") || null,
        role: el.getAttribute("role") || null,
        classes: pickClassTokens(el),
    };
}

function findByHint(hint) {
    if (!hint) return null;

    let q = hint.tag || "div";
    const filters = [];

    if (hint.testid) filters.push(`[data-testid="${CSS.escape(hint.testid)}"]`);
    else if (hint.aria) filters.push(`[aria-label="${CSS.escape(hint.aria)}"]`);
    else if (hint.role) filters.push(`[role="${CSS.escape(hint.role)}"]`);

    if (hint.classes && hint.classes.length) {
        filters.push(hint.classes.map((c) => `.${CSS.escape(c)}`).join(""));
    }

    const selector = q + filters.join("");
    const candidates = Array.from(document.querySelectorAll(selector));
    const scrollables = candidates.filter(isScrollable);
    if (scrollables.length) return scrollables[0];
    return candidates[0] || null;
}

// FAST: only walk ancestors; no global scanning (keeps Wikipedia/GitHub happy)
function findScrollContainerFromNode(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement;

    while (el && el !== document.body) {
        if (isScrollable(el)) return el;
        el = el.parentElement;
    }

    const main = document.querySelector("main");
    if (main && isScrollable(main)) return main;

    return null; // window scroll
}

function computeSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;

    const text = sel.toString().trim().replace(/\s+/g, " ");
    const title = text ? text.slice(0, 60) : "Pinned spot";

    const rect = range.getBoundingClientRect();
    const container = findScrollContainerFromNode(
        range.commonAncestorContainer
    );

    if (container) {
        const cRect = container.getBoundingClientRect();
        const topInContainer =
            container.scrollTop + (rect.top - cRect.top) - 120;

        return {
            title,
            target: {
                type: "element",
                selector: cssPath(container),
                hint: containerHint(container),
                top: Math.max(0, topInContainer),
            },
        };
    }

    const topInWindow = Math.max(0, rect.top + window.scrollY - 140);
    return {
        title,
        target: {
            type: "window",
            selector: null,
            hint: null,
            top: topInWindow,
        },
    };
}

function cacheSelectionIfAny() {
    const info = computeSelectionInfo();
    if (!info) return;
    lastSelection = info;
    lastSelectionAt = Date.now();
}

function getSelectionInfoWithFallback() {
    const cur = computeSelectionInfo();
    if (cur) return cur;

    const now = Date.now();
    if (lastSelection && now - lastSelectionAt <= SELECTION_TTL_MS) {
        return lastSelection;
    }
    return null;
}

/* ---------------- Top-frame UI (lazy) ---------------- */

function ensurePanel() {
    if (!isTopFrame()) return null;

    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
    <div class="hdr">
      <div class="title">Pins</div>
      <div class="btns">
        <button id="aa-clear" type="button">Clear</button>
        <button id="aa-close" type="button">Close</button>
      </div>
    </div>
    <div class="list" id="aa-list"></div>
    <div class="hint">Right-click selection → Pin selection • Shortcut: Alt+A</div>
  `;
    document.body.appendChild(panel);

    panel.querySelector("#aa-close").onclick = () => hidePanel();
    panel.querySelector("#aa-clear").onclick = async () => {
        await setPins([]);
        await renderPanel();
    };

    return panel;
}

function showPanel() {
    const panel = ensurePanel();
    if (!panel) return;
    panel.style.display = "block";
}

function hidePanel() {
    const panel = ensurePanel();
    if (!panel) return;
    panel.style.display = "none";
}

function togglePanel() {
    const panel = ensurePanel();
    if (!panel) return;
    const cur = panel.style.display;
    panel.style.display = cur === "none" || !cur ? "block" : "none";
}

async function renderPanel() {
    if (!isTopFrame()) return;

    const panel = ensurePanel();
    if (!panel) return;

    const list = panel.querySelector("#aa-list");
    const pins = await getPins();

    list.innerHTML = "";
    if (!pins.length) {
        list.innerHTML = `<div style="opacity:.8;margin-top:6px;">No pins yet.</div>`;
        return;
    }

    pins.slice()
        .reverse()
        .forEach((p) => {
            const row = document.createElement("div");
            row.className = "row";

            const jumpBtn = document.createElement("button");
            jumpBtn.className = "jump";
            jumpBtn.type = "button";
            jumpBtn.textContent = p.title || "Pinned spot";
            jumpBtn.onclick = () => {
                chrome.runtime.sendMessage(
                    { type: "AA_JUMP_TO_TARGET", target: p.target },
                    () => {
                        if (chrome.runtime.lastError) return;
                    }
                );
            };

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.textContent = "✕";
            delBtn.style.width = "40px";
            delBtn.onclick = async () => {
                const next = (await getPins()).filter((x) => x.id !== p.id);
                await setPins(next);
                await renderPanel();
            };

            row.appendChild(jumpBtn);
            row.appendChild(delBtn);
            list.appendChild(row);
        });
}

/* ---------------- Pin / Jump (any frame) ---------------- */

async function addPinFromSelectionInThisFrame() {
    const info = getSelectionInfoWithFallback();
    if (!info) return false;

    const pins = await getPins();
    pins.push({
        id: crypto.randomUUID(),
        title: info.title,
        target: info.target,
        createdAt: Date.now(),
    });
    await setPins(pins);

    chrome.runtime.sendMessage({ type: "AA_REFRESH_PANEL" }, () => {
        if (chrome.runtime.lastError) return;
    });

    return true;
}

function smoothScrollElement(el, top) {
    try {
        el.scrollTo({ top, behavior: "smooth" });
        return true;
    } catch {}

    try {
        el.scrollTop = top;
        requestAnimationFrame(() => {
            el.scrollTop = top;
        });
        return true;
    } catch {
        return false;
    }
}

function smoothScrollWindow(top) {
    try {
        window.scrollTo({ top, behavior: "smooth" });
        return true;
    } catch {}

    try {
        window.scrollTo(0, top);
        return true;
    } catch {
        return false;
    }
}

function jumpToTargetHere(target) {
    if (!target || typeof target.top !== "number") return false;

    if (target.type === "element") {
        let el = null;
        if (target.selector) el = document.querySelector(target.selector);
        if (!el && target.hint) el = findByHint(target.hint);
        if (el) return smoothScrollElement(el, target.top);
        return false;
    }

    const before = window.scrollY;
    smoothScrollWindow(target.top);

    // If window doesn't move, fallback to nearest scroll container from body (ancestor-only fast)
    setTimeout(() => {
        const moved = Math.abs(window.scrollY - before) > 2;
        if (moved) return;

        const best = findScrollContainerFromNode(document.body);
        if (best) smoothScrollElement(best, target.top);
    }, 120);

    return true;
}

/* ---------------- Selection caching (reliable + light) ---------------- */

// Don't do heavy work repeatedly; cache only on key moments.
document.addEventListener(
    "mousedown",
    (e) => {
        if (e.button === 2) cacheSelectionIfAny(); // right button
    },
    true
);

document.addEventListener(
    "contextmenu",
    () => {
        cacheSelectionIfAny();
    },
    true
);

// Keep a minimal cache on selectionchange, but throttle via rAF
let selRAF = 0;
document.addEventListener("selectionchange", () => {
    if (selRAF) return;
    selRAF = requestAnimationFrame(() => {
        selRAF = 0;
        cacheSelectionIfAny();
    });
});

/* ---------------- Messages ---------------- */

chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.type) return;

    if (msg.type === "AA_PIN_FROM_SELECTION") {
        addPinFromSelectionInThisFrame();
    }

    if (msg.type === "AA_TOGGLE_PANEL") {
        if (!isTopFrame()) return;
        togglePanel();
        renderPanel();
    }

    if (msg.type === "AA_REFRESH_PANEL") {
        if (!isTopFrame()) return;
        showPanel();
        renderPanel();
    }

    if (msg.type === "AA_JUMP_TO_TARGET") {
        jumpToTargetHere(msg.target);
    }
});
