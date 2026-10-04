async function toggleSidebar() {
  try {
    await browser.sidebarAction.toggle();
  } catch (error) {
    console.error(
      "Page AI Translator: sidebar toggle failed",
      error
    );
  }
}

browser.action.onClicked.addListener(toggleSidebar);

browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-sidebar") {
    toggleSidebar();
  }
});
