import Script from 'next/script'

/**
 * Google Tag Manager for the /sell-used-car campaign page (owner, 2026-09-19). Google's own snippet,
 * loaded after hydration through next/script (inline scripts need an `id`), plus the <noscript> iframe.
 *
 * ⚠️ THIS PAGE ONLY — deliberately not the root layout. A GTM container can inject any script its
 * owners configure, and the dashboard behind the login shows customer names and phone numbers.
 *
 * The form pushes a `sell_car_lead` event on a first successful submission (sell-car-form.tsx) with
 * no personal data in it — never the name or mobile.
 */
export const GTM_ID = 'GTM-PKQ9XM5H'

export function GoogleTagManager() {
  return (
    <>
      <Script
        id="gtm-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`,
        }}
      />
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  )
}
