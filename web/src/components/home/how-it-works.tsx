import { ChancesFragment, QuestionFragment, RaiseFragment } from "@/components/fragments/fragments";
import { steps } from "@/content/home";
import { Scene } from "@/components/motion/scene";

/** Tiles that grow: order is carried by size, each tile holding that stage of the product. */
export function HowItWorks() {
  const tiles = [
    { span: "lg:col-start-1 lg:col-end-4", h: "h-[34vw] sm:h-[30vw] lg:h-[34vh]", bg: "bg-surface", frag: <QuestionFragment /> },
    { span: "lg:col-start-4 lg:col-end-8", h: "h-[46vw] sm:h-[40vw] lg:h-[46vh]", bg: "bg-cobalt-tint", frag: <ChancesFragment /> },
    { span: "lg:col-start-8 lg:col-end-13", h: "h-[62vw] sm:h-[52vw] lg:h-[60vh]", bg: "bg-cobalt", frag: <RaiseFragment /> },
  ];
  return (
    <section className="frame section" aria-labelledby="how-title">
      <Scene kind="grow-tiles" className="grid grid-cols-1 gap-x-2.5 gap-y-7 lg:grid-cols-12 lg:grid-rows-[auto_auto]">
        <h2
          id="how-title"
          className="text-head lg:col-start-1 lg:col-end-8 lg:row-start-1 lg:self-start"
        >
          How it works
        </h2>
        {tiles.map((t, i) => (
          <div key={i} className={`flex flex-col gap-5 lg:row-start-1 lg:self-end ${t.span}`}>
            <div className={`grow-tile relative overflow-hidden rounded-[var(--radius)] ${t.bg} ${t.h}`}>
              <div
                className="absolute left-1/2 top-1/2 w-[min(86%,26rem)]"
                style={{ transform: `translate(-50%, -50%) scale(${0.86 + i * 0.07})`, transformOrigin: "center" }}
              >
                {t.frag}
              </div>
            </div>
            <div className="lg:hidden">
              <h3 className="text-lead font-medium">{steps[i].name}</h3>
              <p className="mt-1.5 max-w-[34ch] text-body text-soft">{steps[i].text}</p>
            </div>
          </div>
        ))}
        {steps.map((s, i) => (
          <div key={s.name} className={`hidden lg:block lg:row-start-2 ${tiles[i].span}`}>
            <h3 className="text-[1.25rem] font-medium leading-snug">{s.name}</h3>
            <p className="mt-1.5 max-w-[34ch] text-body text-soft">{s.text}</p>
          </div>
        ))}
      </Scene>
    </section>
  );
}
