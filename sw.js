// Service Worker for Sanctum Cafe PWA
const CACHE_NAME = 'sanctum-cafe-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Files to cache for offline functionality
const STATIC_CACHE_URLS = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json',
  '/offline.html',
  // Add more static assets as needed
];

// API endpoints to cache
const API_CACHE_URLS = [
  '/api/settings',
  '/api/menu',
  '/api/categories',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching static files');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => {
        console.log('Service Worker: Skip waiting');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Cache failed', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Claiming clients');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // If online, return the response and cache it (only for GET requests)
          if (request.method === 'GET' && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseClone);
              });
          }
          return response;
        })
        .catch(() => {
          // If offline, try to serve from cache
          return caches.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // If no cached version, serve offline page
              return caches.match(OFFLINE_URL);
            });
        })
    );
    return;
  }

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache GET requests with successful responses
          if (response.status === 200 && request.method === 'GET') {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseClone);
              });
          }
          return response;
        })
        .catch(() => {
          // If offline, try to serve from cache (only for GET requests)
          if (request.method === 'GET') {
            return caches.match(request)
              .then((cachedResponse) => {
                if (cachedResponse) {
                  return cachedResponse;
                }
                // Return a generic offline response for API calls
                return new Response(
                  JSON.stringify({
                    error: 'Offline',
                    message: 'This feature is not available offline'
                  }),
                  {
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: {
                      'Content-Type': 'application/json'
                    }
                  }
                );
              });
          } else {
            // For non-GET requests when offline, return appropriate error
            return new Response(
              JSON.stringify({
                error: 'Offline',
                message: 'Cannot perform this action while offline'
              }),
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: {
                  'Content-Type': 'application/json'
                }
              }
            );
          }
        })
    );
    return;
  }

  // Handle static assets
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(request)
          .then((response) => {
            // Cache successful responses (only for GET requests)
            if (response.status === 200 && request.method === 'GET') {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(request, responseClone);
                });
            }
            return response;
          });
      })
  );
});

// Handle background sync for offline orders
self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync triggered', event.tag);
  
  if (event.tag === 'background-sync-orders') {
    event.waitUntil(syncOfflineOrders());
  }
});

// Handle push notifications
self.addEventListener('push', (event) => {
  console.log('Service Worker: Push notification received', event);
  
  let notificationData = {
    title: 'Sanctum Cafe',
    body: 'New notification from Sanctum Cafe',
    type: 'general'
  };

  // Parse notification data if available
  if (event.data) {
    try {
      notificationData = event.data.json();
    } catch (error) {
      notificationData.body = event.data.text();
    }
  }

  const { title, body, type, orderData } = notificationData;
  
  // Customize notification based on type
  let options = {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    vibrate: [200, 100, 200],
    requireInteraction: true,
    data: {
      dateOfArrival: Date.now(),
      type,
      orderData
    }
  };

  // Customize based on notification type
  switch (type) {
    case 'new_order':
      options.title = `🆕 New Order #${orderData?.id || 'Unknown'}`;
      options.body = `${orderData?.customerName || 'Customer'} placed an order for $${orderData?.total || '0.00'}`;
      options.tag = `order-${orderData?.id}`;
      options.actions = [
        {
          action: 'view_order',
          title: 'View Order',
          icon: '/icons/icon-96x96.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
          icon: '/icons/icon-96x96.png'
        }
      ];
      break;
      
    case 'order_status':
      options.title = `📦 Order Update #${orderData?.id || 'Unknown'}`;
      options.body = `Your order is now ${orderData?.status || 'updated'}`;
      options.tag = `status-${orderData?.id}`;
      options.actions = [
        {
          action: 'track_order',
          title: 'Track Order',
          icon: '/icons/icon-96x96.png'
        },
        {
          action: 'dismiss',
          title: 'OK',
          icon: '/icons/icon-96x96.png'
        }
      ];
      break;
      
    default:
      options.title = title;
      options.actions = [
        {
          action: 'open_app',
          title: 'Open App',
          icon: '/icons/icon-96x96.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
          icon: '/icons/icon-96x96.png'
        }
      ];
  }

  event.waitUntil(
    self.registration.showNotification(options.title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked', event);
  
  event.notification.close();

  const { action } = event;
  const { type, orderData } = event.notification.data || {};

  let urlToOpen = '/';

  // Determine URL based on action and notification type
  switch (action) {
    case 'view_order':
      if (orderData?.id) {
        urlToOpen = `/admin/orders?highlight=${orderData.id}`;
      } else {
        urlToOpen = '/admin/orders';
      }
      break;
      
    case 'track_order':
      if (orderData?.id) {
        urlToOpen = `/customer/orders?order=${orderData.id}`;
      } else {
        urlToOpen = '/customer/orders';
      }
      break;
      
    case 'open_app':
      urlToOpen = '/';
      break;
      
    case 'dismiss':
      // Just close, don't open anything
      return;
      
    default:
      // Default click (not on action button)
      if (type === 'new_order') {
        urlToOpen = '/admin/orders';
      } else if (type === 'order_status') {
        urlToOpen = '/customer/orders';
      }
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if app is already open
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            // Focus existing window and navigate
            client.focus();
            client.postMessage({
              type: 'NAVIGATE',
              url: urlToOpen
            });
            return;
          }
        }
        
        // Open new window if app is not open
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Sync offline orders when back online
async function syncOfflineOrders() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const offlineOrders = await cache.match('/offline-orders');
    
    if (offlineOrders) {
      const orders = await offlineOrders.json();
      
      for (const order of orders) {
        try {
          await fetch('/api/orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(order)
          });
        } catch (error) {
          console.error('Failed to sync order:', error);
        }
      }
      
      // Clear offline orders after successful sync
      await cache.delete('/offline-orders');
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Message handling for communication with main thread
self.addEventListener('message', (event) => {
  console.log('Service Worker: Message received', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});