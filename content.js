// Content script — signals readiness and handles frame messages.
(function () {
  chrome.runtime.sendMessage({ type: 'mailReady' }).catch(() => {});
})();
