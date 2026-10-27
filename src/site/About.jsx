import { Link } from 'react-router-dom'
import { ArrowRight, Handshake, MapPin, ShieldCheck, Star, Truck } from 'lucide-react'
import { SHOP } from './siteInfo'
import { CtaBand, PageHero, SectionHead, ShopPhoto, WhatsAppButton, usePageMeta } from './pieces'

const VALUES = [
  { icon: ShieldCheck, title: 'Fair, clear rates', text: 'Carton and loose rates on every bill, so a shopkeeper can check every line and price it on.' },
  { icon: Handshake, title: 'Long-term customers', text: 'Many of the shops we supply have ordered from us for years. We would rather keep a customer than win one order.' },
  { icon: Truck, title: 'Orders out on time', text: 'Ready stock at the shop and godown, packed by carton and handed to transport the same day where possible.' },
]

export default function About() {
  usePageMeta('About', 'Royal Stationers is a long-standing wholesale stationery supplier in Urdu Bazar, Lahore, serving shops, schools and offices across Pakistan.')

  return (
    <>
      <PageHero
        eyebrow="About us"
        title="A familiar name in Urdu Bazar."
        lead="Royal Stationers has supplied stationery shops, schools and offices from Urdu Bazar, Lahore for many years. Our counter is on the first floor of Bashir Center, and our customers are spread across Pakistan."
        actions={
          <Link to="/contact" className="site-btn site-btn-primary">
            <MapPin />
            Visit the shop
          </Link>
        }
        aside={
          <ShopPhoto
            badge={
              <>
                <span className="icon-tile h-10 w-10">
                  <Star size={20} className="fill-current" />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-[14px] font-semibold text-ink">Rated {SHOP.rating} on Google</span>
                  <span className="block text-[13px] text-ink-2">By customers who visit the shop</span>
                </span>
              </>
            }
          />
        }
      />

      <section className="border-b border-line">
        <div className="site-wrap grid gap-10 py-16 md:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <SectionHead eyebrow="Our work" title="We keep the shelves of other shops full." />
          <div className="grid gap-5 text-[17px] text-ink-2">
            <p>
              Urdu Bazar is where Lahore's stationery trade buys its stock, and Royal Stationers is part of that trade. We bring in office and school
              stationery, including our own imports, and sell it on to the shops, schools and offices that serve the end customer.
            </p>
            <p>
              That is why everything we do is measured in cartons. Our rates leave room for the shopkeeper's margin, our bills show cartons and loose
              pieces line by line, and our dispatch is built around bilty, so a shop in another city can order as easily as one down the street.
            </p>
            <p>
              Behind the counter, every sale, return and payment is recorded in our own system, so regular customers always have a clear ledger.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-surface-2">
        <div className="site-wrap py-16 md:py-24">
          <SectionHead eyebrow="How we work" title="Three things our customers count on." />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {VALUES.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-lg border border-line bg-surface p-6 shadow-[var(--shadow-sm)]">
                <span className="icon-tile">
                  <Icon size={22} />
                </span>
                <h3 className="mt-5 text-[18px] text-ink">{title}</h3>
                <p className="mt-2 text-[15px] text-ink-2">{text}</p>
              </article>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap gap-3">
            <WhatsAppButton />
            <Link to="/wholesale" className="site-btn site-btn-outline">
              How wholesale works
              <ArrowRight />
            </Link>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  )
}
