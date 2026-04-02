// Service Worker for Push Notifications

self.addEventListener('push', event => {
    let data = {};

    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        console.error("Push parse error:", e);
    }

    const title = data.title || "Smart Reminder";

    const options = {
        body: data.body || "New message received",
        icon: 'https://cdn-icons-png.flaticon.com/512/1827/1827347.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/1827/1827347.png',

        // 🔥 keep notification visible
        requireInteraction: true,

        // prevent duplicate stacking
        tag: data.tag || "broadcast",

        // 🔥 IMPORTANT (used in click)
        data: {
            url: data.url || '/dashboard.html'
        }
    };

    // 🔔 Show notification PROPERLY
    event.waitUntil(
        self.registration.showNotification(title, options)
    );

    // 📡 Send message to all open tabs (for popup + sound)
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true })
            .then(clientList => {
                clientList.forEach(client => {
                    client.postMessage(data);
                });
            })
    );
});


// 🔔 Handle notification click
self.addEventListener('notificationclick', event => {
    event.notification.close();

    const urlToOpen = event.notification.data?.url || '/dashboard.html';

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true })
            .then(clientList => {

                // Focus existing tab if already open
                for (let client of clientList) {
                    if (client.url.includes(urlToOpen) && 'focus' in client) {
                        return client.focus();
                    }
                }

                // Otherwise open new tab
                return clients.openWindow(urlToOpen);
            })
            .catch(err => console.error("❌ Click error:", err))
    );
});