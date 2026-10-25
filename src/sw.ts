/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

/** 共有されたデータを画面に渡すための一時置き場 */
const SHARE_CACHE = 'share-inbox';

// Android の共有メニューから「家計簿」に送られた写真・テキストを受け取る
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const cache = await caches.open(SHARE_CACHE);
      await Promise.all([cache.delete('image'), cache.delete('text')]);
      const image = form.getAll('image').find((f): f is File => f instanceof File && f.size > 0);
      if (image) await cache.put('image', new Response(image, { headers: { 'content-type': image.type || 'image/jpeg' } }));
      const text = ['title', 'text', 'url']
        .map((k) => form.get(k))
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .join('\n');
      if (text) await cache.put('text', new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } }));
      return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
    })(),
  );
});

// アプリ本体をキャッシュしてオフラインでも起動できるようにする
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// 新しいバージョンをすぐに有効にする
self.skipWaiting();
clientsClaim();
