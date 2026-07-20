/**
 * Sentry Error Monitoring initializer for RTS.
 * Optimized for Free Tier with beforeSend noise filtering.
 */

export function initSentry() {
  try {
    const defaultDsn = "https://a5a64d2190093ce4b8972dd9a6907828@o4511766757244928.ingest.de.sentry.io/4511766900310096";
    const metaDsn = document.querySelector('meta[name="sentry-dsn"]')?.getAttribute('content');
    const dsn = window.SENTRY_DSN || window.RTS_SENTRY_DSN || metaDsn || defaultDsn;

    if (!dsn) {
      return;
    }

    const beforeSend = (event, hint) => {
      const error = hint?.originalException;
      const message = event?.message || (error && error.message) || "";

      // Ignore common harmless browser/network noise to preserve Sentry free quota
      const noisePatterns = [
        /ResizeObserver loop/i,
        /Failed to fetch/i,
        /NetworkError/i,
        /Load failed/i,
        /Script error/i,
        /top.GLOBALS/i,
        /chrome-extension:\/\//i,
        /moz-extension:\/\//i,
      ];

      if (noisePatterns.some((pattern) => pattern.test(message))) {
        return null;
      }

      return event;
    };

    const config = {
      dsn: dsn,
      environment: window.SENTRY_ENVIRONMENT || "production",
      tracesSampleRate: parseFloat(window.SENTRY_TRACES_SAMPLE_RATE || "0.02"),
      beforeSend: beforeSend,
      ignoreErrors: [
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications.",
        "NetworkError when attempting to fetch resource.",
        "Failed to fetch",
        "Load failed",
      ],
    };

    if (window.Sentry) {
      window.Sentry.init({
        ...config,
        integrations: [
          window.Sentry.browserTracingIntegration ? window.Sentry.browserTracingIntegration() : null,
        ].filter(Boolean),
      });
      console.log("[RTS] Sentry error monitoring initialized");
    } else {
      const script = document.createElement("script");
      script.src = "https://browser.sentry-cdn.com/8.48.0/bundle.min.js";
      script.crossOrigin = "anonymous";
      script.onload = () => {
        if (window.Sentry) {
          window.Sentry.init(config);
          console.log("[RTS] Sentry error monitoring initialized via dynamic load");
        }
      };
      document.head.appendChild(script);
    }
  } catch (err) {
    console.warn("[RTS] Sentry initialization failed:", err);
  }
}
