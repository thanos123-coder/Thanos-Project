import Image, { type StaticImageData } from "next/image";
import gb from "flag-icons/flags/4x3/gb.svg";
import us from "flag-icons/flags/4x3/us.svg";
import ca from "flag-icons/flags/4x3/ca.svg";
import nl from "flag-icons/flags/4x3/nl.svg";
import de from "flag-icons/flags/4x3/de.svg";
import ch from "flag-icons/flags/4x3/ch.svg";
import it from "flag-icons/flags/4x3/it.svg";
import sg from "flag-icons/flags/4x3/sg.svg";
import ae from "flag-icons/flags/4x3/ae.svg";
import gr from "flag-icons/flags/4x3/gr.svg";
import cn from "flag-icons/flags/4x3/cn.svg";
import fr from "flag-icons/flags/4x3/fr.svg";
import inFlag from "flag-icons/flags/4x3/in.svg";
import { Scene } from "@/components/motion/scene";

type Item = { name: string; value: string; text: string; flag?: StaticImageData; mark?: string };

const systems: Item[] = [
  { name: "IB Diploma", value: "45 points", text: "Predicted grades, Higher Level subjects and the core.", mark: "IB" },
  { name: "A-levels", value: "A* to E", text: "Predicted grades and the subjects each course asks for.", flag: gb },
  { name: "US high school", value: "GPA and APs", text: "Your GPA, course rigour, APs and tests where they count.", flag: us },
  { name: "Greek Panhellenic exams", value: "20,000 points", text: "Points by field, and your Μηχανογραφικό choices.", flag: gr },
  { name: "Gaokao", value: "750 points", text: "Provincial scores read against each university’s requirements.", flag: cn },
  { name: "Abitur", value: "1.0 to 4.0", text: "Your Abitur grade, read for each country you apply to.", flag: de },
  { name: "Baccalauréat", value: "out of 20", text: "Your average and your specialty subjects.", flag: fr },
  { name: "CBSE", value: "percentage", text: "Board percentages and subject combinations.", flag: inFlag },
  { name: "ISC", value: "percentage", text: "Board percentages and subject combinations.", flag: inFlag },
];

const destinations: Item[] = [
  { name: "United Kingdom", value: "UCAS", text: "Conditional offers, results day and Clearing.", flag: gb },
  { name: "United States", value: "Common App", text: "Essays, activities and recommendations read as a whole.", flag: us },
  { name: "Canada", value: "OUAC or direct", text: "Ontario applies through OUAC; other provinces apply to each university.", flag: ca },
  { name: "Netherlands", value: "Studielink", text: "Applications through Studielink, some courses with a fixed number of places.", flag: nl },
  { name: "Germany", value: "uni-assist", text: "Many universities take international applications through uni-assist.", flag: de },
  { name: "Switzerland", value: "Direct", text: "Apply to each university, with entry rules for foreign diplomas.", flag: ch },
  { name: "Italy", value: "Universitaly", text: "Pre-enrolment through Universitaly, plus each university’s own steps.", flag: it },
  { name: "Singapore", value: "Direct", text: "Apply to each university, sometimes with interviews or tests.", flag: sg },
  { name: "United Arab Emirates", value: "Direct", text: "Apply to each university or branch campus.", flag: ae },
];

function Bullet({ item }: { item: Item }) {
  if (item.flag) {
    return (
      <span className="relative block h-10 w-16 shrink-0 overflow-hidden rounded-full bg-surface">
        <Image src={item.flag} alt="" fill sizes="64px" className="object-cover" unoptimized />
      </span>
    );
  }
  return (
    <span className="grid h-10 w-16 shrink-0 place-items-center rounded-full bg-cobalt text-small font-bold text-on-cobalt">
      {item.mark}
    </span>
  );
}

function Category({ title, items, id }: { title: string; items: Item[]; id: string }) {
  return (
    <div className="mt-20 first:mt-14 lg:mt-24">
      <div className="mb-10 flex items-baseline justify-between gap-4">
        <h3 id={id} className="text-[clamp(1.75rem,1.1rem+2vw,3.125rem)] leading-tight tracking-[-0.03em]">
          {title}
        </h3>
        <p className="text-body text-soft tabular">{items.length}</p>
      </div>
      <ul aria-labelledby={id} className="grid gap-x-16 gap-y-9 md:grid-cols-2">
        {items.map((it) => (
          <li key={it.name} className="flex gap-5">
            <Bullet item={it} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span className="text-[1.125rem] font-bold leading-snug">{it.name}</span>
                <span className="shrink-0 text-body text-soft">{it.value}</span>
              </p>
              <p className="mt-1 max-w-[42ch] text-body text-soft">{it.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Two-column menu with picture bullets: every school system and every country, in full. */
export function Coverage() {
  return (
    <section className="frame section" aria-labelledby="coverage-title">
      <div className="grid-12 gap-y-6">
        <h2 id="coverage-title" className="col-span-12 text-head lg:col-span-7">
          Made for students everywhere
        </h2>
        <p className="col-span-12 max-w-[30ch] self-end text-lead text-soft lg:col-span-4 lg:col-start-9">
          Whatever you study now, and wherever you dream of going next.
        </p>
      </div>
      <Scene kind="rows">
        <Category id="systems-title" title="School systems" items={systems} />
        <Category id="countries-title" title="Universities in" items={destinations} />
      </Scene>
    </section>
  );
}
