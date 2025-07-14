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
    // Don't intercept authentication-related requests to avoid session conflicts
    const isAuthRequest = url.pathname.includes('/auth/') || 
                         url.pathname.includes('/verify') || 
                         url.pathname.includes('/refresh');
    
    if (isAuthRequest) {
      // Let authentication requests pass through directly without caching
      event.respondWith(fetch(request));
      return;
    }

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
        .catch((error) => {
          console.log('SW: API request failed:', url.pathname, error.message);
          
          // Check if we're actually offline vs other network errors
          if (!navigator.onLine) {
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
          } else {
            // If online but request failed, re-throw the error to let the app handle it
            throw error;
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
      console.log('Parsed notification data:', notificationData);
    } catch (error) {
      console.error('Error parsing notification data:', error);
      notificationData.body = event.data.text();
    }
  }

  const { title, body, type, orderData, timestamp } = notificationData;
  
  // Base notification options optimized for background notifications
  let options = {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: true,
    silent: false,
    renotify: true,
    persistent: true,
    sticky: true,
    data: {
      dateOfArrival: Date.now(),
      type,
      orderData,
      timestamp,
      url: '/',
      clickAction: '/'
    }
  };

  // Customize based on notification type
  switch (type) {
    case 'new_order':
      const orderId = orderData?.id || orderData?._id || 'Unknown';
      const customerName = orderData?.customerName || orderData?.customer?.name || 'Customer';
      const total = orderData?.total || '0.00';
      const itemCount = orderData?.items?.length || 0;
      const itemsText = itemCount === 1 ? '1 item' : `${itemCount} items`;
      
      options.title = `🆕 New Order #${orderId}`;
      options.body = `${customerName} placed an order (${itemsText}) for ₹${total}`;
      options.tag = `order-${orderId}`;
      options.data.url = `/admin/orders?highlight=${orderId}`;
      options.actions = [
        {
          action: 'view_order',
          title: 'View Order',
          icon: '/icons/icon-96x96.png'
        },
        {
          action: 'accept_order',
          title: 'Accept',
          icon: '/icons/icon-96x96.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
          icon: '/icons/icon-96x96.png'
        }
      ];
      
      // Enhanced vibration pattern for new orders
      options.vibrate = [300, 100, 300, 100, 300];
      break;
      
    case 'order_status':
      const statusOrderId = orderData?.id || orderData?._id || 'Unknown';
      const status = orderData?.status || 'updated';
      
      options.title = `📦 Order Update #${statusOrderId}`;
      options.body = body || `Your order is now ${status}`;
      options.tag = `status-${statusOrderId}`;
      options.data.url = `/customer/orders?order=${statusOrderId}`;
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
      
    case 'test':
      options.title = '🧪 Test Notification';
      options.body = body || 'This is a test notification from Sanctum Cafe';
      options.tag = 'test-notification';
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
      break;
      
    default:
      options.title = title || 'Sanctum Cafe';
      options.body = body || 'New notification from Sanctum Cafe';
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

  // Show the notification
  event.waitUntil(
    self.registration.showNotification(options.title, options)
      .then(() => {
        console.log('Notification displayed successfully');
      })
      .catch((error) => {
        console.error('Error displaying notification:', error);
      })
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked', event);
  console.log('Action:', event.action);
  console.log('Notification data:', event.notification.data);
  
  event.notification.close();

  const { action } = event;
  const { type, orderData, url: dataUrl } = event.notification.data || {};
  const orderId = orderData?.id || orderData?._id;

  let urlToOpen = dataUrl || '/';

  // Determine URL based on action and notification type
  switch (action) {
    case 'view_order':
    case 'accept_order':
      if (orderId) {
        urlToOpen = `/admin/orders?highlight=${orderId}`;
      } else {
        urlToOpen = '/admin/orders';
      }
      break;
      
    case 'track_order':
      if (orderId) {
        urlToOpen = `/customer/orders?order=${orderId}`;
      } else {
        urlToOpen = '/customer/orders';
      }
      break;
      
    case 'open_app':
      urlToOpen = '/';
      break;
      
    case 'dismiss':
      // Just close, don't open anything
      console.log('Notification dismissed');
      return;
      
    default:
      // Default click (not on action button)
      if (type === 'new_order') {
        urlToOpen = orderId ? `/admin/orders?highlight=${orderId}` : '/admin/orders';
      } else if (type === 'order_status') {
        urlToOpen = orderId ? `/customer/orders?order=${orderId}` : '/customer/orders';
      } else if (dataUrl) {
        urlToOpen = dataUrl;
      }
  }

  console.log('Opening URL:', urlToOpen);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        console.log('Found clients:', clientList.length);
        
        // Check if app is already open
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            console.log('Focusing existing client and navigating');
            // Focus existing window and navigate
            client.focus();
            client.postMessage({
              type: 'NAVIGATE',
              url: urlToOpen,
              notificationData: { type, orderData, action }
            });
            return;
          }
        }
        
        // Open new window if app is not open
        console.log('Opening new window');
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
      .catch((error) => {
        console.error('Error handling notification click:', error);
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