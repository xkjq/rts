/**
 * Sentry Error Monitoring initializer for RTS.
 * Optimized for Free Tier with beforeSend noise filtering.
 */

export function initSentry() {
  try {
    const defaultDsn = "https://017b4494d7038e3e789fe38378b53fb2@o4511766757244928.ingest.de.sentry.io/4511766894477392";
    const metaDsn = document.querySelector('meta[name="sentry-dsn"]')?.getAttribute('content');
    const dsn = window.SENTRY_DSN || window.RTS_SENTRY_DSN || metaDsn || defaultDsn;

    if (!dsn) {
      window.SENTRY_STATUS = { loaded: false, reason: "No DSN configured" };
      console.warn("[Sentry] ❌ Error monitoring disabled (No DSN provided)");
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

    const onInitialized = () => {
      window.SENTRY_STATUS = { loaded: true, dsn: dsn, environment: config.environment };
      console.info(`[Sentry] ✅ Error monitoring initialized (Env: ${config.environment})`);

      // Expose a convenient window.testSentry() function for testing from browser console
      window.testSentry = function(msg = "RTS Sentry Test Event") {
        if (window.Sentry && typeof window.Sentry.captureException === "function") {
          const testErr = new Error(msg);
          window.Sentry.captureException(testErr);
          console.info("[Sentry] 🚀 Sent test error event to Sentry:", testErr);
          return "Sentry test event sent!";
        } else {
          console.error("[Sentry] ❌ Sentry is not available to send test event");
          return "Failed to send event";
        }
      };
    };

    if (window.Sentry) {
      window.Sentry.init({
        ...config,
        integrations: [
          window.Sentry.browserTracingIntegration ? window.Sentry.browserTracingIntegration() : null,
        ].filter(Boolean),
      });
      onInitialized();
    } else {
      const script = document.createElement("script");
      script.src = "https://browser.sentry-cdn.com/8.48.0/bundle.min.js";
      script.crossOrigin = "anonymous";
      script.onload = () => {
        if (window.Sentry) {
          window.Sentry.init(config);
          onInitialized();
        }
      };
      script.onerror = () => {
        window.SENTRY_STATUS = { loaded: false, reason: "Failed to load Sentry CDN script" };
        console.warn("[Sentry] ❌ Failed to load Sentry CDN script");
      };
      document.head.appendChild(script);
    }
  } catch (err) {
    window.SENTRY_STATUS = { loaded: false, error: err };
    console.warn("[Sentry] ❌ Initialization failed:", err);
  }
}
