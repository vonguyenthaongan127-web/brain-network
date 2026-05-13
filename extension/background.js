// Brain Network — MV3 Service Worker
// Minimal background script; all logic lives in popup.js

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Relay page-info requests if needed in future
  sendResponse({ ok: true });
  return true;
});
