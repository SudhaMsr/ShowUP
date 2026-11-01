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
 * Action buttons (and the data they carry back) only work through the service
 * worker, so they are dropped on the plain `new Notification` fallback.
 * @param {{ title: string, body?: string, tag?: string, data?: Record<string, unknown>, actions?: Array<{ action: string, title: string }>, requireInteraction?: boolean }} n
 * @returns {Promise<boolean>} whether a notification was shown
 */
export async function showSystemNotification(n) {
  if (notificationState() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      const max = /** @type {any} */ (Notification).maxActions ?? 2;
      await reg.showNotification(n.title, {
        body: n.body ?? '',
        tag: n.tag,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        data: n.data,
        requireInteraction: n.requireInteraction,
        /** @type {any} */ ...({ actions: (n.actions ?? []).slice(0, max) }),
      });
    } else {
      new Notification(n.title, { body: n.body ?? '', tag: n.tag, icon: 'icons/icon-192.png' });
    }
    return true;
  } catch {
    return false;
  }
}
