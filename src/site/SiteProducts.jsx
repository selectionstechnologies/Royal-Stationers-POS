import { ArrowUpRight, Check } from 'lucide-react'
import { CATEGORIES, waLink } from './siteInfo'
import { CtaBand, PageHero, SectionHead, WhatsAppButton, WhatsAppIcon, usePageMeta } from './pieces'

export default function SiteProducts() {
  usePageMeta('Products', 'Calculators, pens, markers, files, tape, glue, staplers, notebooks and school supplies at wholesale rates from Royal Stationers, Urdu Bazar Lahore.')

  return (
    <>
      <PageHero
        eyebrow="Products"
        title="Every shelf of a stationery shop, from one supplier."
        lead="Eight departments of office and school stationery, stocked by the carton. Rates change with the market, so we share the current list on WhatsApp."
        actions={<WhatsAppButton text="Assalam o Alaikum, mujhe poori rate list chahiye.">Get the full rate list</WhatsAppButton>}
        aside={<CategoryMosaic />}
      />

      <section className="bg-surface-2">
        <div className="site-wrap py-16 md:py-24">
          <SectionHead
            eyebrow="Departments"
            title="Choose a department to ask for its rates."
            text="Tap a department and WhatsApp opens with your question already written. Send it as it is, or add the items and quantities you need."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {CATEGORIES.map(({ icon: Icon, name, text, items }) => (
              <article key={name} className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-6 shadow-[var(--shadow-sm)] sm:flex-row">
                <span className="icon-tile">
                  <Icon size={22} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <h2 className="text-[19px] text-ink">{name}</h2>
                  <p className="mt-1 text-[15px] text-ink-2">{text}</p>
                  <ul className="mt-4 grid gap-2 text-[15px] text-ink">
                    {items.map((item) => (
                      <li key={item} className="flex items-center gap-2.5">
                        <Check size={16} className="text-good" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={waLink(`Assalam o Alaikum, mujhe ${name} ke wholesale rates chahiye.`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="site-btn site-btn-sm site-btn-outline mt-6 self-start"
                  >
                    <WhatsAppIcon />
                    Ask for {name.toLowerCase()} rates
                    <ArrowUpRight />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <CtaBand title="Can't see what you need?" text="We stock far more than fits on one page. Send a photo of your list and we will tell you what is in stock." />
    </>
  )
}

// Hero visual: the eight departments as a grid of tiles on a card, like a shelf plan
function CategoryMosaic() {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-lg)] sm:p-6">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">Shelf plan</span>
        <span className="text-[13px] text-ink-3">8 departments</span>
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CATEGORIES.map(({ icon: Icon, name }) => (
          <li key={name} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg bg-surface-2 p-2 text-center">
            <span className="text-primary">
              <Icon size={26} />
            </span>
            <span className="text-[12px] font-medium leading-tight text-ink-2">{name.split(' and ')[0]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
