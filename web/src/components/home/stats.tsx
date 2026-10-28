import { stats } from "@/content/home";
import { CountUp } from "@/components/ui/count-up";
import { Scene } from "@/components/motion/scene";

/** Stepped figure tiles: three figures on three tiles that refuse to line up, the heading in the notch. */
export function Stats() {
  const [a, b, c] = stats.tiles;
  return (
    <section className="frame section" aria-labelledby="stats-title">
      <Scene kind="stepped-tiles" className="grid grid-cols-2 gap-1.5 lg:grid-cols-12 lg:grid-rows-[14vh_auto] lg:gap-2">
        <h2
          id="stats-title"
          className="col-span-2 mb-4 text-[clamp(1.625rem,1.2rem+1vw,2.25rem)] leading-tight lg:col-start-7 lg:col-end-10 lg:row-start-1 lg:mb-0 lg:self-end lg:pb-6"
        >
          {stats.heading}
        </h2>

        <div
          data-field="cobalt"
          className="stat-tile col-span-2 flex min-h-[56vw] flex-col justify-between rounded-[var(--radius)] rounded-tr-[999px] bg-cobalt p-6 text-on-cobalt sm:p-8 lg:col-start-1 lg:col-end-7 lg:row-start-1 lg:row-end-3 lg:min-h-[70vh] lg:rounded-tr-[45vh]"
        >
          <p className="text-[clamp(4rem,15vw,9rem)] font-medium leading-none tracking-[-0.05em] lg:text-[clamp(4rem,8.6vw,10rem)]">
            <CountUp value={a.figure} />
          </p>
          <p className="max-w-[22ch] text-lead">{a.caption}</p>
        </div>

        <div className="stat-tile flex min-h-[46vw] flex-col justify-between self-start rounded-[var(--radius)] rounded-tr-[999px] bg-ink p-5 text-paper sm:p-7 lg:col-start-7 lg:col-end-10 lg:row-start-2 lg:min-h-[44vh] lg:rounded-tr-[22vh]">
          <p className="text-[clamp(2.5rem,11vw,5rem)] font-medium leading-none tracking-[-0.05em] lg:text-[clamp(3rem,4.6vw,5.5rem)]">
            <CountUp value={b.figure} />
          </p>
          <p className="max-w-[20ch] text-body text-white/85">{b.caption}</p>
        </div>

        <div className="stat-tile mt-8 flex min-h-[46vw] flex-col justify-between self-start rounded-[var(--radius)] rounded-tr-[999px] bg-mid p-5 sm:p-7 lg:col-start-10 lg:col-end-13 lg:row-start-1 lg:row-end-3 lg:mt-[26vh] lg:min-h-[34vh] lg:rounded-tr-[17vh]">
          <p className="text-[clamp(2.5rem,11vw,5rem)] font-medium leading-none tracking-[-0.05em] lg:text-[clamp(3rem,4.6vw,5.5rem)]">
            <CountUp value={c.figure} />
          </p>
          <p className="max-w-[20ch] text-body">{c.caption}</p>
        </div>
      </Scene>
    </section>
  );
}
