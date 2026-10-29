// The Period (CONTEXT.md): one filter the Timeline and the Map share. The
// fixture asks the question the feature exists for, "prophets, 640–580 BCE".
import { describe, expect, it } from "vitest";
import type { DatedProperty, DocSummary, DocType } from "../api";
import {
  filterByPeriod,
  formatPeriod,
  itemsOf,
  NO_PERIOD_FILTER,
  type Period,
  type PeriodFilter,
} from "../period";

function doc(id: string, type: DocType): DocSummary {
  return {
    id,
    path: `${id}.md`,
    title: id,
    label: id,
    type,
    mtime: 0,
    book: null,
    chapter: null,
    verse: null,
    lat: null,
    lon: null,
    first_verse: null,
    start: null,
    end: null,
  };
}

/** A Date Property; `year` is astronomical, so 640 BCE is -639. */
function dated(d: DocSummary, name: string, year: number | null): DatedProperty {
  return {
    doc: d,
    name,
    text: String(year),
    date: year == null ? null : { year, month: null, day: null, approx: false },
    precision: year == null ? null : "year",
  };
}

const bce = (n: number) => 1 - n;

const jeremiah = doc("jeremiah", "character");
const isaiah = doc("isaiah", "character");
const paul = doc("paul", "character");
const habakkuk = doc("habakkuk", "character"); // undated
const fall = doc("fall-of-jerusalem", "event");
const exodus = doc("exodus", "event");
const josiahReform = doc("josiah-reform", "event"); // undated
const jerusalem = doc("jerusalem", "place"); // no Span
const babylon = doc("neo-babylonian-empire", "place");
const nineveh = doc("nineveh", "place"); // founded only
const rome = doc("rome", "place"); // ended only... in the far future, here

const rows: DatedProperty[] = [
  dated(jeremiah, "born", bce(650)),
  dated(jeremiah, "died", bce(570)),
  dated(isaiah, "born", bce(760)),
  dated(isaiah, "died", bce(680)),
  dated(paul, "born", 5),
  dated(paul, "died", 67),
  dated(fall, "start", bce(587)),
  dated(exodus, "start", bce(1446)),
  dated(babylon, "start", bce(626)),
  dated(babylon, "end", bce(539)),
  dated(nineveh, "start", bce(1800)),
  dated(rome, "end", 476),
];
const undatedDocs = [habakkuk, josiahReform, jerusalem];
const tags = new Map<string, string[]>([
  ["jeremiah", ["prophet"]],
  ["isaiah", ["prophet"]],
  ["habakkuk", ["Prophet"]],
  ["paul", ["apostle"]],
]);
const items = itemsOf(rows, undatedDocs, tags);

const period = (from: number | null, to: number | null): Period => ({ from, to });
const run = (f: Partial<PeriodFilter>) => {
  const r = filterByPeriod(items, { ...NO_PERIOD_FILTER, ...f });
  return { ids: r.visible.map((i) => i.doc.id).sort(), undated: r.undated };
};

describe("filterByPeriod", () => {
  it("shows what overlaps the Period and hides what lies wholly outside it", () => {
    const { ids } = run({ period: period(bce(640), bce(580)) });
    expect(ids).toContain("jeremiah"); // born before, alive within
    expect(ids).toContain("fall-of-jerusalem"); // a point within
    expect(ids).toContain("neo-babylonian-empire"); // begins within, ends after
    expect(ids).not.toContain("isaiah"); // died before it began
    expect(ids).not.toContain("paul"); // born long after
    expect(ids).not.toContain("exodus");
  });

  it("hides undated Characters and Events while a Period is set, and counts them", () => {
    const { ids, undated } = run({ period: period(bce(640), bce(580)) });
    expect(ids).not.toContain("habakkuk");
    expect(ids).not.toContain("josiah-reform");
    expect(undated).toBe(2);
  });

  it("hides nothing and counts nothing without a Period", () => {
    const { ids, undated } = run({});
    expect(ids).toHaveLength(items.length);
    expect(undated).toBe(0);
  });

  it("keeps a Place with no Span in every Period", () => {
    expect(run({ period: period(bce(640), bce(580)) }).ids).toContain("jerusalem");
    expect(run({ period: period(30, 60) }).ids).toContain("jerusalem");
  });

  it("runs a Span missing one end on without limit that way", () => {
    // Nineveh has a `start` only: founded 1800 BCE, it still counts in 500 CE.
    expect(run({ period: period(500, 600) }).ids).toContain("nineveh");
    // Rome has an `end` only: it counts in any Period before 476 CE…
    expect(run({ period: period(bce(640), bce(580)) }).ids).toContain("rome");
    // …and in none after it.
    expect(run({ period: period(500, 600) }).ids).not.toContain("rome");
  });

  it("keeps an Event with only a `start` a single point, not an open Span", () => {
    // The Exodus happened once; it is not still happening in 640 BCE.
    expect(run({ period: period(bce(640), bce(580)) }).ids).not.toContain("exodus");
    expect(run({ period: period(bce(1450), bce(1440)) }).ids).toContain("exodus");
  });

  it("combines Tags with the Period: prophets, 640–580 BCE", () => {
    const { ids, undated } = run({
      period: period(bce(640), bce(580)),
      tags: ["PROPHET"],
    });
    expect(ids).toEqual(["jeremiah"]);
    // Habakkuk is a prophet with no Date: left out, and counted.
    expect(undated).toBe(1);
  });

  it("narrows by Tags alone, any of them, without a Period", () => {
    const { ids, undated } = run({ tags: ["prophet", "apostle"] });
    expect(ids).toEqual(["habakkuk", "isaiah", "jeremiah", "paul"]);
    expect(undated).toBe(0);
  });
});

describe("formatPeriod", () => {
  const eras = { bce: "BCE", ce: "CE" };
  it("names the era once when both ends share it", () => {
    expect(formatPeriod(period(bce(640), bce(580)), eras)).toBe("640–580 BCE");
    expect(formatPeriod(period(30, 60), eras)).toBe("30–60 CE");
  });
  it("names both eras when the Period crosses them", () => {
    expect(formatPeriod(period(bce(4), 30), eras)).toBe("4 BCE – 30 CE");
  });
  it("reads a lone year as itself, and an open end as a dash", () => {
    expect(formatPeriod(period(bce(587), bce(587)), eras)).toBe("587 BCE");
    expect(formatPeriod(period(bce(640), null), eras)).toBe("640 BCE –");
    expect(formatPeriod(period(null, 70), eras)).toBe("– 70 CE");
  });
  it("puts the ends in order whichever was typed first", () => {
    expect(formatPeriod(period(bce(580), bce(640)), eras)).toBe("640–580 BCE");
  });
});
