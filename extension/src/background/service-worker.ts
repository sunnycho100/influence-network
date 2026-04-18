import { handleInternalMessage } from '../lib/internal-messaging';
import { handleExternalMessage } from '../lib/messaging';

chrome.runtime.onInstalled.addListener(() => {
  console.info('AlumniGraph service worker installed');
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void handleExternalMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    });

  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleInternalMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    });

  return true;
});
