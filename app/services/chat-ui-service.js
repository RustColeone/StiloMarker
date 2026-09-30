export function shouldSubmitChat(event, mobile = false) {
  return event.key === "Enter" && !event.isComposing && event.keyCode !== 229
    && !event.shiftKey && Boolean(!mobile || event.ctrlKey || event.metaKey);
}
export function isChatNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 64;
}
export function installMobileViewport(window, element, maxWidth = 900) {
  const update = () => {
    const viewport = window.visualViewport;
    if (!window.matchMedia(`(max-width: ${maxWidth}px)`).matches || !viewport || viewport.scale !== 1) {
      element.style.removeProperty('--mobile-viewport-height');
      return;
    }
    element.style.setProperty('--mobile-viewport-height', `${viewport.height}px`);
  };
  window.visualViewport?.addEventListener('resize', update);
  window.addEventListener('resize', update);
  update();
  return update;
}
