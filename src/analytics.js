const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
const enabled = import.meta.env.PROD
  && measurementId
  && /^G-[A-Z0-9]+$/.test(measurementId)
  && location.origin === 'https://puma-academic.observe.tw';

function gtag() {
  window.dataLayer.push(arguments);
}

if (enabled) {
  const page = new URL(location.pathname, location.origin);
  const query = new URLSearchParams(location.search);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term', 'utm_content']) {
    const value = query.get(key);
    if (value) page.searchParams.set(key, value);
  }

  window.dataLayer ??= [];
  gtag('js', new Date());
  gtag('config', measurementId, {
    page_location: page.href,
    page_referrer: document.referrer ? new URL(document.referrer).origin : '',
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.append(script);
}

export function track(eventName) {
  if (enabled) gtag('event', eventName);
}
