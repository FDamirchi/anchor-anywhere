const MENU_PIN = "aa_pin_selection";
const MENU_SHOW = "aa_toggle_panel";

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: MENU_PIN,
        title: "Pin selection",
        contexts: ["selection"],
    });

    chrome.contextMenus.create({
        id: MENU_SHOW,
        title: "Show pins",
        contexts: ["page"],
    });
});

function sendToTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, message, () => {
        if (chrome.runtime.lastError) return;
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === MENU_PIN)
        sendToTab(tab.id, { type: "AA_PIN_FROM_SELECTION" });
    if (info.menuItemId === MENU_SHOW)
        sendToTab(tab.id, { type: "AA_TOGGLE_PANEL" });
});

chrome.action.onClicked.addListener((tab) => {
    if (!tab?.id) return;
    sendToTab(tab.id, { type: "AA_TOGGLE_PANEL" });
});

chrome.commands.onCommand.addListener((command) => {
    if (command !== "toggle_panel") return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (!tab?.id) return;
        sendToTab(tab.id, { type: "AA_TOGGLE_PANEL" });
    });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
    const tabId = sender?.tab?.id;
    if (!tabId || !msg?.type) return;

    if (msg.type === "AA_REFRESH_PANEL") {
        sendToTab(tabId, { type: "AA_REFRESH_PANEL" });
    }

    if (msg.type === "AA_JUMP_TO_TARGET") {
        sendToTab(tabId, { type: "AA_JUMP_TO_TARGET", target: msg.target });
    }
});
