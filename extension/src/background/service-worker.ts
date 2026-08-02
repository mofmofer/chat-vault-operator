/**
 * Background service worker.
 *
 * Its entire job is opening the side panel. It holds no state, listens to no
 * network events, and talks to no server — all real work happens in the side
 * panel, which the user can see.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Older Chrome builds lack setPanelBehavior; the onClicked path below
      // still opens the panel, so this is not worth surfacing.
    });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  // Must be called synchronously in the click handler to stay within the user
  // gesture, otherwise Chrome rejects the open.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
    /* Panel is already open, or the tab went away. */
  });
});
