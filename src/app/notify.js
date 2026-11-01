// @ts-check
/**
 * System notifications. In-app toasts are the guaranteed channel; these are a
 * best-effort extra while the app (or its service worker) is alive.
 */

/** @returns {'granted'|'denied'|'default'|'unsupported'} */
export function notificationState() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/**
 * Ask for permission. Must be called from a user gesture.
 * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>}
 */
export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Show a system notification if permitted. Never throws: a notification failure
 * must not break reminder handling.
 * @param {{ title: string, body?: string, tag?: string }} n
 * @returns {Promise<boolean>} whether a notification was shown
 */
export async function showSystemNotification(n) {
  if (notificationState() !== 'granted') return false;
  const options = { body: n.body ?? '', tag: n.tag, icon: 'icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(n.title, options);
    else new Notification(n.title, options);
    return true;
  } catch {
    return false;
  }
}
