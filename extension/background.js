chrome.action.onClicked.addListener(async tab => {
  if (tab.id && tab.url?.startsWith("https://github.com/")) {
    try {
      await chrome.tabs.sendMessage(tab.id, {type: "repofeed:toggle"});
      return;
    } catch {
      // Существующая вкладка может быть открыта до установки расширения.
    }
  }
  await chrome.tabs.create({url: chrome.runtime.getURL("index.html")});
});
