import { HomeHero } from "@/components/home/hero";
import { Stats } from "@/components/home/stats";
import { Features } from "@/components/home/features";
import { HowItWorks } from "@/components/home/how-it-works";
import { Coverage } from "@/components/home/coverage";
import { Trust } from "@/components/home/trust";
import { PricingTeaser } from "@/components/home/pricing-teaser";
import { FaqCards } from "@/components/ui/faq-cards";
import { ClosingCta } from "@/components/home/closing-cta";
import { homeFaq } from "@/content/home";

export default function Home() {
  return (
    <>
      <HomeHero />
      <Stats />
      <Features />
      <HowItWorks />
      <Coverage />
      <Trust />
      <PricingTeaser />
      <FaqCards id="faq-title" title="Questions, answered" items={homeFaq} />
      <ClosingCta />
    </>
  );
}
