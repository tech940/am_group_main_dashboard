async function showWorkflowNotification(payload) {
  const title = payload?.title || 'Workflow notification'
  const options = {
    body: payload?.body || 'A workflow update is available.',
    icon: payload?.icon || '/favicon.ico',
    badge: payload?.badge || '/favicon.ico',
    tag: payload?.tag || `po-notification-${Date.now()}`,
    data: {
      actionUrl: payload?.actionUrl || '/purchase-orders',
      referenceNumber: payload?.referenceNumber || null,
      workflowStage: payload?.workflowStage || null,
    },
  }

  await self.registration.showNotification(title, options)
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    event.waitUntil(showWorkflowNotification(event.data.payload))
  }
})

self.addEventListener('push', (event) => {
  let payload = {}

  try {
    payload = event.data ? event.data.json() : {}
  } catch (error) {
    payload = {
      title: 'Workflow notification',
      body: event.data ? event.data.text() : 'A workflow update is available.',
      actionUrl: '/purchase-orders',
    }
  }

  event.waitUntil(showWorkflowNotification(payload))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const actionUrl = event.notification.data?.actionUrl || '/purchase-orders'
  const destination = new URL(actionUrl, self.location.origin).href

  event.waitUntil((async () => {
    const windows = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    for (const client of windows) {
      if ('focus' in client) {
        await client.navigate(destination)
        await client.focus()
        return
      }
    }

    await clients.openWindow(destination)
  })())
})
