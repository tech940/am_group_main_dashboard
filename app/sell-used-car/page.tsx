import type { Metadata, Viewport } from 'next'
import { Caveat, Lato } from 'next/font/google'
import Image from 'next/image'
import { GoogleTagManager } from './google-tag-manager'
import { Burst, CalloutArrow, FigureBackdrop } from './pointing-figure'
import { SellCarForm } from './sell-car-form'
import styles from './sell-used-car.module.css'

/*
 * ⚠️ PUBLIC campaign page — the MD shares this link on WhatsApp. `/sell-used-car` is not a protected prefix in
 * lib/supabase/middleware.ts, and it must stay that way. One URL only: the earlier /evaluation and /sell-car
 * copies were removed so every lead is counted from one place (vehicle_evaluations, source 'sell-used-car';
 * add ?utm_source=…&utm_campaign=… to the shared link to tell campaigns apart).
 */

const lato = Lato({ subsets: ['latin'], weight: ['400', '700', '900'], variable: '--font-sell', display: 'swap' })
/** The handwritten callout beside the figure (owner's mock). Used for that one line only. */
const caveat = Caveat({ subsets: ['latin'], weight: ['600'], variable: '--font-hand', display: 'swap' })

const TITLE = 'What’s your car worth? Free evaluation in Jammu · AM Group'
const DESCRIPTION =
  'Tell us about your car in three quick steps and book a free evaluation with AM Group, Jammu. Sell it, or put it towards a new Hyundai, Kia, Tata or MG.'

export const metadata: Metadata = {
  // WhatsApp needs an absolute preview-image URL; this is the dashboard's own domain.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://app.amautomotivegroup.com'),
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { title: 'What’s your car worth?', description: DESCRIPTION, type: 'website', siteName: 'AM Group, Jammu' },
}

export const viewport: Viewport = { themeColor: '#ffffff', colorScheme: 'light' }

/** The number for people who would rather ring than fill in the form (owner, 2026-09-19). */
const CALL_NUMBER = '9484200000'
const CALL_NUMBER_SHOWN = '94842 00000'

/**
 * The group's dealerships, badged as the dashboard's own brand list has them (components/layout/sidebar.tsx). Names are
 * the customer-facing ones: the dashboard's "AM Platinum" is shown as "AM Hyundai Paloura" here (owner, 2026-09-19).
 */
const DEALERSHIPS = [
  { name: 'AM Hyundai', sells: 'Hyundai cars', logo: '/brand-logos/hyundai.svg', width: 64, height: 32, shown: 40 },
  { name: 'AM Hyundai Paloura', sells: 'Hyundai cars', logo: '/brand-logos/hyundai.svg', width: 64, height: 32, shown: 40 },
  { name: 'AM Kia', sells: 'Kia cars', logo: '/brand-logos/kia.svg', width: 96, height: 22, shown: 18 },
  { name: 'AM Tata', sells: 'Tata cars', logo: '/brand-logos/tata.svg', width: 48, height: 36, shown: 32 },
  { name: 'AM MG', sells: 'MG cars', logo: '/brand-logos/mg.svg', width: 40, height: 40, shown: 36 },
  // The PNG carries a wide white margin around the wing, so it needs more height to read at the same size.
  { name: 'AM Diamond Honda', sells: 'Honda two-wheelers', logo: '/brand-logos/diamond-honda.png', width: 447, height: 447, shown: 64 },
  { name: 'AM KTM', sells: 'KTM motorcycles', logo: '/brand-logos/ktm.svg', width: 84, height: 24, shown: 20 },
  { name: 'AM Bajaj', sells: 'Bajaj motorcycles', logo: '/brand-logos/bajaj.svg', width: 84, height: 30, shown: 26 },
] as const

/** A real sequence — what happens after the form — so the numbers carry meaning. */
const STEPS = [
  { title: 'Tell us about your car', body: 'Brand, model, year and kilometres. It takes about a minute, right here.' },
  { title: 'We call you', body: 'An AM Group evaluator calls to fix a day, time and place that suit you.' },
  {
    title: 'Get your price',
    body: 'After a short look at the car, you get the price. The evaluation is free, and whether to sell is up to you.',
  },
] as const

const QUESTIONS = [
  {
    q: 'Is the evaluation really free?',
    a: 'Yes. Nothing is charged for the evaluation, and you decide afterwards whether to sell.',
  },
  {
    q: 'Do I have to buy a new car from AM Group?',
    a: 'No. Sell your car outright, or put its value towards a new Hyundai, Kia, Tata or MG — your choice.',
  },
  {
    q: 'Which cars do you evaluate?',
    a: 'Any brand and model — petrol, diesel, CNG or electric. If yours isn’t in the list, choose “Other” and type it in.',
  },
  {
    q: 'What should I keep ready?',
    a: 'The RC, the insurance papers, the service record if you have it, and both keys.',
  },
] as const

export default function SellUsedCarPage() {
  return (
    <main className={`${lato.variable} ${caveat.variable} ${styles.page}`}>
      <GoogleTagManager />
      <div className={styles.upper}>
        <div className={`${styles.shell} ${styles.upperGrid}`}>
          <div className={styles.intro}>
            <Image
              className={styles.logo}
              src="/assets/am-group-logo-watermark.jpg"
              alt="AM Group"
              width={760}
              height={504}
              priority
              sizes="72px"
            />
            <h1 className={styles.title}>What’s your car worth?</h1>
            <p className={styles.lede}>
              <span className={styles.brandName}>AM Group, Jammu</span> evaluates any car, any brand, free. Sell it, or
              put it towards a new Hyundai, Kia, Tata or MG.
            </p>
            {/* Phones: no room for the figure, so the callout points down at the form instead. */}
            <p className={styles.calloutMobile} aria-hidden="true">
              <span>Get your car’s value in seconds!</span>
              <CalloutArrow direction="down" />
            </p>
          </div>
          <div className={styles.figure}>
            <span className={styles.figureBackdrop}>
              <FigureBackdrop />
            </span>
            <Image
              className={styles.figureImage}
              src="/assets/sell-evaluator.webp"
              alt="An AM Group evaluator in the company sweatshirt, pointing at the form"
              width={1060}
              height={1181}
              sizes="(min-width: 1280px) 320px, 250px"
            />
            <p className={styles.callout} aria-hidden="true">
              Get your
              <br />
              car’s value
              <br />
              in seconds!
            </p>
            <span className={styles.calloutArrow}>
              <CalloutArrow direction="right" />
            </span>
          </div>
          <div id="evaluate" className={styles.cardSlot}>
            <SellCarForm />
            <p className={styles.callLine}>
              Rather talk to us?{' '}
              <a className={styles.callLink} href={`tel:+91${CALL_NUMBER}`}>
                Call {CALL_NUMBER_SHOWN}
              </a>
            </p>
            <span className={styles.burst}>
              <Burst />
            </span>
          </div>
        </div>
      </div>

      <div className={styles.lower}>
        <div className={`${styles.shell} ${styles.lowerGrid}`}>
          <div className={styles.lowerInner}>
            {/* Facts from amgroupind.com. */}
            <p className={styles.trust}>
              AM Group has been in Jammu since <span className={styles.trustFigure}>1968</span>, has sold Hyundai cars
              since <span className={styles.trustFigure}>2008</span>, and runs{' '}
              <span className={styles.trustFigure}>26</span>
              {' showrooms across Jammu & Kashmir.'}
            </p>
            <figure className={styles.photo}>
              {/* The AM Hyundai showroom front, supplied by the owner 2026-09-19 (replaced the AM Kia interior). */}
              <Image
                src="/assets/am-hyundai-showroom.webp"
                alt="The front of the AM Hyundai showroom, with Hyundai cars on display behind the glass"
                width={1305}
                height={774}
                sizes="(min-width: 900px) 460px, calc(100vw - 32px)"
              />
            </figure>
          </div>
        </div>
      </div>

      <section className={`${styles.section} ${styles.sectionPaper}`} aria-labelledby="how-title">
        <div className={styles.shell}>
          <h2 id="how-title" className={styles.sectionTitle}>
            How it works
          </h2>
          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.stepItem}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepBody}>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMist}`} aria-labelledby="brands-title">
        <div className={styles.shell}>
          <h2 id="brands-title" className={styles.sectionTitle}>
            One group, eight dealerships
          </h2>
          <p className={styles.sectionLede}>
            AM Group sells new cars and two-wheelers across Jammu &amp; Kashmir, and the same group evaluates your car.
          </p>
          <ul className={styles.brands}>
            {DEALERSHIPS.map((d) => (
              <li key={d.name} className={styles.brand}>
                <span className={styles.brandLogo}>
                  <Image src={d.logo} alt="" width={d.width} height={d.height} style={{ height: d.shown, width: 'auto' }} />
                </span>
                <span className={styles.brandTitle}>{d.name}</span>
                <span className={styles.brandSells}>{d.sells}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionPaper}`} aria-labelledby="faq-title">
        <div className={`${styles.shell} ${styles.faqGrid}`}>
          <h2 id="faq-title" className={styles.sectionTitle}>
            Questions
          </h2>
          <div className={styles.faq}>
            {QUESTIONS.map((item) => (
              <details key={item.q} className={styles.faqItem}>
                <summary className={styles.faqQuestion}>{item.q}</summary>
                <p className={styles.faqAnswer}>{item.a}</p>
              </details>
            ))}
          </div>
          <div className={styles.closing}>
            <p className={styles.closingText}>Ready? It takes about a minute.</p>
            <div className={styles.closingActions}>
              <a href="#evaluate" className={styles.closingButton}>
                Get my car’s price
              </a>
              <span className={styles.closingOr}>or</span>
              <a className={styles.callButton} href={`tel:+91${CALL_NUMBER}`}>
                Call {CALL_NUMBER_SHOWN}
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
