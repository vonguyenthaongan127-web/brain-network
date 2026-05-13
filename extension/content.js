// Brain Network — Content Script
// Provides the current page title and URL to the popup on request.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_PAGE_INFO") {
    sendResponse({
      title: document.title || "",
      url:   window.location.href || "",
    });
  }
  return true; // keep channel open for async
});
