"use client";

import { useMemo, useState } from "react";
import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Select, TextArea, TextInput, shake } from "@/components/ui/fields";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/tabs";
import { FaqCards } from "@/components/ui/faq-cards";
import { BlurText } from "@/components/vendor/blur-text";
import {
  billingOptions,
  compareGroups,
  compareIntro,
  fairUseNote,
  plans,
  plansFaq,
  priceRegions,
  trustPoints,
  type BillingId,
  type Plan,
  type PriceRegion,
} from "@/content/plans";

const Check = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={clsx("size-5", className)} role="img" aria-label="Included">
    <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Dash = () => (
  <span className="text-soft" role="img" aria-label="Not included">
    –
  </span>
);

/** The locale that writes each currency the way its own buyers expect ($9.99, €9,99 written as €9.99 in English). */
function localeFor(currency: string) {
  return currency === "USD" ? "en-US" : currency === "EUR" ? "en-IE" : "en-GB";
}

function usePricing(billing: BillingId, region: PriceRegion) {
  return useMemo(() => {
    const locale = localeFor(region.currency);
    const fmt = (v: number) =>
      new Intl.NumberFormat(locale, { style: "currency", currency: region.currency, maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v * region.rate);
    const fmtFlow = { style: "currency" as const, currency: region.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 };
    return { fmt, fmtFlow, rate: region.rate, billing, locale };
  }, [billing, region]);
}

function PlanCard({ plan, billing, region }: { plan: Plan; billing: BillingId; region: PriceRegion }) {
  const { fmt, fmtFlow, rate } = usePricing(billing, region);
  const price = plan.prices?.[billing];
  const monthly = plan.prices?.monthly.perMonth ?? 0;
  const save = price
    ? billing === "yearly"
      ? `You save ${fmt(monthly * 12 - price.billed)} a year`
      : billing === "fouryear"
        ? `You save ${fmt(monthly * 48 - price.billed)} over 4 years`
        : null
    : null;
  const billedNote = price
    ? billing === "monthly"
      ? `Then ${fmt(price.billed)} plus tax every month. Cancel anytime.`
      : price.billedNote
    : null;
  const featured = plan.id === "plus";
  const current = plan.current;

  return (
    <article
      className={clsx(
        "plan-card relative flex flex-col rounded-[var(--radius)] p-6 sm:p-7 md:row-span-8 md:grid md:grid-rows-subgrid md:gap-y-0",
        featured ? "bg-ink text-paper" : "bg-paper text-ink",
        current && "shadow-[inset_0_0_0_3px_var(--cobalt)]",
      )}
      aria-labelledby={`plan-${plan.id}`}
      data-field={featured ? "ink" : undefined}
    >
      {plan.badge || current ? (
        <p className="absolute -top-4 left-6 flex h-8 items-center gap-2 rounded-full bg-cobalt pl-2 pr-4 text-small font-medium text-on-cobalt">
          <span className="size-4 rounded-full bg-paper" aria-hidden />
          {current ? "Your plan" : plan.badge}
        </p>
      ) : null}
      <h3 id={`plan-${plan.id}`} className="text-[2rem] font-medium leading-tight tracking-[-0.02em]">
        {plan.name}
      </h3>
      <p className={clsx("mt-1 text-body md:min-h-0", featured ? "text-white/75" : "text-soft")}>{plan.for}</p>

      <div className="mt-6 min-h-[5.5rem]">
        {price ? (
          <>
            <p className={clsx("text-small", featured ? "text-white/70" : "text-soft", billing === "monthly" && "invisible")}>Works out to</p>
            <p className="flex items-end gap-2">
              <span className="text-[clamp(2.5rem,2rem+1.4vw,3.25rem)] font-medium leading-none tracking-[-0.04em] tabular">
                <NumberFlow value={price.perMonth * rate} format={fmtFlow} locales={localeFor(region.currency)} />
              </span>
              <span className={clsx("pb-1 text-body", featured ? "text-white/75" : "text-soft")}>/ month</span>
            </p>
          </>
        ) : (
          <>
            <p className="text-small invisible">Works out to</p>
            {/* NumberFlow pads its digits by a quarter em; match it so "Free" sits on the same line as the prices */}
            <p className="pt-[0.25em] text-[clamp(2.5rem,2rem+1.4vw,3.25rem)] font-medium leading-none tracking-[-0.04em]">Free</p>
            <p className="mt-2 text-body text-soft">No card needed, ever</p>
          </>
        )}
      </div>

      {price ? (
        <div className={clsx("mt-5 rounded-[1.25rem] p-4", featured ? "bg-white/8" : "bg-ground")}>
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-small font-medium">Billed today</span>
            <span className="text-body font-medium tabular">
              <NumberFlow value={price.billed * rate} format={fmtFlow} locales={localeFor(region.currency)} /> plus tax
            </span>
          </p>
          <p className={clsx("mt-1.5 text-small", featured ? "text-white/70" : "text-soft")}>{billedNote}</p>
        </div>
      ) : (
        <div className="mt-5 min-h-[5.6rem]" aria-hidden />
      )}
      <p className={clsx("mt-3 min-h-[1.5em] text-body font-medium", featured ? "text-[#a9b0ff]" : "text-cobalt")}>{save ?? ""}</p>

      <div className="mt-5">
        {current ? (
          <Button tone="outline" dot={false} className="w-full" disabled aria-disabled>
            {plan.cta}
          </Button>
        ) : plan.id === "free" ? (
          <LinkButton href="/assessment" tone="outline" dot={false} className="w-full">
            {plan.cta}
          </LinkButton>
        ) : (
          <Button
            tone={featured ? "cobalt" : "outline"}
            dot={featured}
            className="w-full"
            onClick={() => toast(`${plan.name} chosen. Checkout would open here, with tax shown up front.`)}
          >
            {plan.cta}
          </Button>
        )}
      </div>

      <ul className="mt-7 flex flex-1 flex-col gap-3">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-3 text-body">
            <Check className={clsx("mt-0.5 shrink-0", featured ? "text-[#a9b0ff]" : "text-cobalt")} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <p className={clsx("mt-7 text-small", featured ? "text-white/65" : "text-soft")}>{plan.ai}</p>
    </article>
  );
}

function CompareTable({ billing, region }: { billing: BillingId; region: PriceRegion }) {
  const { fmtFlow, rate } = usePricing(billing, region);
  const [mobilePlan, setMobilePlan] = useState<Plan["id"]>("plus");
  const mobileIndex = plans.findIndex((p) => p.id === mobilePlan);

  const cell = (c: boolean | string, featured: boolean) =>
    c === true ? <Check className={clsx("mx-auto", featured ? "text-cobalt" : "text-cobalt")} /> : c === false ? <Dash /> : <span className="font-medium">{c}</span>;

  return (
    <section className="frame section" aria-labelledby="compare-title">
      <h2 id="compare-title" className="text-head">
        Compare what’s in each plan
      </h2>
      <p className="mt-5 max-w-[60ch] text-lead text-soft">{compareIntro}</p>

      {/* Phones: one plan at a time against every row */}
      <div className="mt-10 md:hidden">
        <Segmented
          label="Plan to compare"
          value={mobilePlan}
          onChange={setMobilePlan}
          options={plans.map((p) => ({ value: p.id, label: p.name }))}
        />
        {compareGroups.map((g) => (
          <div key={g.title} className="mt-8">
            <h3 className="text-lead font-medium">{g.title}</h3>
            <ul className="mt-3 flex flex-col gap-1.5">
              {g.rows.map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-4 rounded-[1rem] bg-paper px-4 py-3">
                  <span className="text-body">
                    {r.label}
                    {r.note ? <span className="mt-0.5 block text-small text-soft">{r.note}</span> : null}
                  </span>
                  <span className="shrink-0 text-right text-body">{cell(r.cells[mobileIndex], false)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Tablet and up: the full table, Plus column marked */}
      <div className="mt-12 hidden overflow-hidden rounded-[var(--radius)] bg-paper md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Plan comparison</caption>
          <thead className="sticky top-0 z-10">
            <tr className="bg-paper">
              <th scope="col" className="w-[40%] p-6">
                <span className="sr-only">Feature</span>
              </th>
              {plans.map((p) => (
                <th key={p.id} scope="col" className={clsx("p-6 text-center align-bottom", p.id === "plus" && "bg-cobalt-tint")}>
                  <span className="block text-lead font-medium">{p.name}</span>
                  <span className="mt-1 block text-small font-normal text-soft tabular">
                    {p.prices ? (
                      <>
                        <NumberFlow value={p.prices[billing].perMonth * rate} format={fmtFlow} locales={localeFor(region.currency)} /> / month
                      </>
                    ) : (
                      "Free"
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {compareGroups.map((g) => (
            <tbody key={g.title}>
              <tr>
                <th colSpan={5} scope="colgroup" className="bg-ground px-6 pb-3 pt-8 text-left text-lead font-medium">
                  {g.title}
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.label} className="compare-row">
                  <th scope="row" className="px-6 py-4 text-left align-middle text-body font-normal">
                    {r.label}
                    {r.note ? <span className="mt-1 block text-small text-soft">{r.note}</span> : null}
                  </th>
                  {r.cells.map((c, i) => (
                    <td key={i} className={clsx("px-4 py-4 text-center align-middle text-body", plans[i].id === "plus" && "bg-cobalt-tint/60")}>
                      {cell(c, plans[i].id === "plus")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="mt-5 max-w-[80ch] text-small text-soft">{fairUseNote}</p>
    </section>
  );
}

const schoolErrors: Record<string, string> = {
  school: "Enter your school’s name.",
  name: "Enter your name.",
  email: "Enter a work email, like name@school.org.",
};

function SchoolsForm() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [role, setRole] = useState("counsellor");
  const [size, setSize] = useState("100-499");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fix = (name: string) => setErrors((e) => (e[name] ? { ...e, [name]: "" } : e));
  return (
    <section className="frame py-[calc(var(--section)/2)]" aria-labelledby="schools-title">
      <div className="flex flex-col gap-8 rounded-[2.5rem] bg-cobalt px-8 py-10 text-on-cobalt sm:rounded-[999px] md:flex-row md:items-center md:justify-between md:px-14 md:py-12" data-field="cobalt">
        <div>
          <h2 id="schools-title" className="text-[clamp(2rem,1.3rem+2vw,3.25rem)] leading-[1.02] tracking-[-0.035em]">
            For schools
          </h2>
          <p className="mt-3 max-w-[46ch] text-lead text-white/90">
            Interested in Upchance for your school? Fill out this form and we’ll get back to you.
          </p>
        </div>
        <Modal
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setTimeout(() => setSent(false), 300);
          }}
          trigger={
            <button className="press inline-flex h-14 shrink-0 items-center gap-3 rounded-full bg-paper pl-5 pr-7 text-lead font-medium text-ink hover:bg-white">
              <span className="size-[0.55em] rounded-full bg-cobalt" aria-hidden />
              Fill out the form
            </button>
          }
          title={sent ? "Thanks, we’ve got it" : "Upchance for your school"}
          description={sent ? "We’ll get back to you at the email you gave." : "Tell us a little about your school."}
          wide
        >
          {sent ? (
            <div className="flex flex-col items-start gap-6">
              {/* transitions.dev success check: it turns, settles and draws itself once */}
              <span className="t-success-check grid size-16 place-items-center rounded-full bg-cobalt text-on-cobalt" data-state="in" aria-hidden>
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </span>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <form
              noValidate
              className="grid gap-5 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const invalid = Array.from(form.querySelectorAll<HTMLInputElement>("input[name]")).filter(
                  (el) => !el.checkValidity(),
                );
                if (invalid.length) {
                  setErrors(Object.fromEntries(invalid.map((el) => [el.name, schoolErrors[el.name] ?? "Check this field."])));
                  invalid.forEach(shake);
                  invalid[0].focus();
                  return;
                }
                setErrors({});
                setSent(true);
                toast("Form sent. We’ll be in touch.");
              }}
            >
              <Field label="School name" className="sm:col-span-2" error={errors.school}>
                {({ id, hintId, invalid }) => (
                  <TextInput
                    id={id}
                    name="school"
                    required
                    autoComplete="organization"
                    aria-invalid={invalid}
                    aria-describedby={hintId}
                    onChange={() => fix("school")}
                  />
                )}
              </Field>
              <Field label="Your name" error={errors.name}>
                {({ id, hintId, invalid }) => (
                  <TextInput
                    id={id}
                    name="name"
                    required
                    autoComplete="name"
                    aria-invalid={invalid}
                    aria-describedby={hintId}
                    onChange={() => fix("name")}
                  />
                )}
              </Field>
              <Field label="Your role">
                {({ id }) => (
                  <Select
                    id={id}
                    label="Your role"
                    value={role}
                    onChange={setRole}
                    items={[
                      { value: "counsellor", label: "University counsellor" },
                      { value: "teacher", label: "Teacher" },
                      { value: "head", label: "Head of school" },
                      { value: "other", label: "Something else" },
                    ]}
                  />
                )}
              </Field>
              <Field label="Work email" error={errors.email}>
                {({ id, hintId, invalid }) => (
                  <TextInput
                    id={id}
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    aria-invalid={invalid}
                    aria-describedby={hintId}
                    onChange={() => fix("email")}
                  />
                )}
              </Field>
              <Field label="Students in the final two years">
                {({ id }) => (
                  <Select
                    id={id}
                    label="Students in the final two years"
                    value={size}
                    onChange={setSize}
                    items={[
                      { value: "1-99", label: "Fewer than 100" },
                      { value: "100-499", label: "100 to 499" },
                      { value: "500+", label: "500 or more" },
                    ]}
                  />
                )}
              </Field>
              <Field label="Anything we should know? (optional)" className="sm:col-span-2">
                {({ id }) => <TextArea id={id} />}
              </Field>
              <div className="flex justify-end sm:col-span-2">
                <Button type="submit" size="lg">
                  Send the form
                </Button>
              </div>
            </form>
          )}
        </Modal>
      </div>
    </section>
  );
}

export function PlansView() {
  const [billing, setBilling] = useState<BillingId>("monthly");
  const [regionId, setRegionId] = useState<string>("none");
  const region = priceRegions.find((r) => r.id === regionId) ?? priceRegions[0];

  return (
    <>
      <section className="frame grid-12 items-end gap-y-10 pb-10 pt-10 lg:pt-16" aria-labelledby="plans-title">
        <div className="col-span-12 [container-type:inline-size] lg:col-span-7">
          <h1 id="plans-title" className="text-[clamp(2.4rem,11.6cqi,6.25rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            <BlurText text="Plans for every" className="block" />
            <BlurText text="step to university" start={3} className="block" />
          </h1>
          <p className="mt-7 max-w-[44ch] text-lead text-ink/85">
            Start free with every planning tool. Add AI help when you start writing and applying, and cancel anytime.
          </p>
        </div>
        <div className="col-span-12 rounded-[var(--radius)] bg-paper p-5 sm:p-7 lg:col-span-5" data-ui>
          <Field label="Prices for">
            {({ id }) => (
              <Select
                id={id}
                label="Prices for"
                value={regionId}
                onChange={setRegionId}
                items={priceRegions.map((r) => ({ value: r.id, label: r.id === "none" ? "No location set (US dollars)" : `${r.label} (${r.currencyName})` }))}
              />
            )}
          </Field>
          <Segmented className="mt-4" label="Billing" value={billing} onChange={setBilling} options={billingOptions.map((b) => ({ value: b.id, label: b.label, note: b.note }))} />
          <p className="mt-4 text-small text-soft">
            Shown in {region.currencyName}, before tax.{regionId === "none" ? " Choose your country to see your price." : ""}
          </p>
        </div>
      </section>

      <section className="frame pb-6 pt-8" aria-label="Plans">
        {/* Each card spans eight shared rows (subgrid), so names, prices and buttons line up across plans */}
        <div className="grid gap-x-2 gap-y-8 md:grid-cols-2 md:gap-y-0 xl:grid-cols-4 md:max-xl:[&>*:nth-child(n+3)]:mt-10">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} billing={billing} region={region} />
          ))}
        </div>
        <p className="mt-6 max-w-[80ch] text-small text-soft">{fairUseNote}</p>
        <ul className="mt-6 flex flex-wrap gap-2">
          {trustPoints.map((t) => (
            <li key={t} className="flex items-center gap-2.5 rounded-full bg-surface py-2.5 pl-3 pr-5 text-body">
              <Check className="size-4 text-cobalt" />
              {t}
            </li>
          ))}
        </ul>
      </section>

      <CompareTable billing={billing} region={region} />
      <SchoolsForm />
      <FaqCards id="plans-faq-title" title="Questions" items={plansFaq} />
    </>
  );
}
