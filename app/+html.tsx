import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, maximum-scale=1, user-scalable=no"
        />
        <meta name="theme-color" content="#1F3D2B" />
        <meta
          name="description"
          content="MSU-Zamboanga Sibugay ROTC Attendance & Digital ID System"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ROTC Attendance" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/assets/images/batch-logo.png" />
        <title>MSU-ZS ROTC Attendance</title>

        {/* Service Worker Registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js')
                    .then(function(reg) {
                      console.log('[SW] registered:', reg.scope);
                    })
                    .catch(function(err) {
                      console.warn('[SW] registration failed:', err);
                    });
                });
              }
            `,
          }}
        />

        <ScrollViewStyleReset />

        {/* Disable body scrolling on web for native-feel */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body { overflow: hidden; overscroll-behavior: none; }
              #root { display: flex; flex: 1; height: 100vh; }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
