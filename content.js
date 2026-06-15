(function () {
  chrome.runtime.sendMessage({ type: 'mailReady' }).catch(() => {});
})();
