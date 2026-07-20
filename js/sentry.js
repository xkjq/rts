/**
 * Sentry Error Monitoring initializer for RTS.
 *
 * Configurable via window.SENTRY_DSN or window.RTS_SENTRY_DSN or <meta name="sentry-dsn" content="...">
 */

export function initSentry() {
  try {
    const metaDsn = document.querySelector('meta[name="sentry-dsn"]')?.getAttribute('content');
    const dsn = window.SENTRY_DSN || window.RTS_SENTRY_DSN || metaDsn;

    if (!dsn) {
      return;
    }

    if (window.Sentry) {
      window.Sentry.init({
        dsn: dsn,
        environment: window.SENTRY_ENVIRONMENT || 'production',
        tracesSampleRate: parseFloat(window.SENTRY_TRACES_SAMPLE_RATE || '0.05'),
        integrations: [
          window.Sentry.browserTracingIntegration ? window.Sentry.browserTracingIntegration() : null
        ].filter(Boolean)
      });
      console.log("[RTS] Sentry error monitoring initialized");
    } else {
      // Dynamically load Sentry bundle if DSN is set but Sentry library tag isn't explicitly loaded
      const script = document.createElement('script');
      script.src = 'https://browser.sentry-cdn.com/8.48.0/bundle.min.js';
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        if (window.Sentry) {
          window.Sentry.init({
            dsn: dsn,
            environment: window.SENTRY_ENVIRONMENT || 'production',
            tracesSampleRate: parseFloat(window.SENTRY_TRACES_SAMPLE_RATE || '0.05')
          });
          console.log("[RTS] Sentry error monitoring initialized via dynamic load");
        }
      };
      document.head.appendChild(script);
    }
  } catch (err) {
    console.warn("[RTS] Sentry initialization failed:", err);
  }
}
