// Timeline geometry (PLAN §16): Lanes, year projection, extent.
import { describe, expect, it } from "vitest";
import type { BibleDate, DatedProperty, DocSummary, DocType } from "../api";
import {
  buildLanes,
  extentOf,
  formatYear,
  niceStep,
  yearOf,
} from "../timeline";

const ERAS = { bce: "BCE", ce: "CE" };

function doc(id: string, title: string, type: DocType = "character"): DocSummary {
  return {
    id,
    path: `${title}.md`,
    title,
    type,
    mtime: 0,
    book: null,
    chapter: null,
    verse: null,
    lat: null,
    lon: null,
    first_verse: null,
  };
}

function date(year: number, approx = false, month: number | null = null, day: number | null = null): BibleDate {
  return { year, month, day, approx };
}

function dated(
  d: DocSummary,
  name: string,
  year: number | null,
  approx = false,
): DatedProperty {
  return {
    doc: d,
    name,
    text: year === null ? "sometime" : `${Math.abs(year)}`,
    date: year === null ? null : date(year, approx),
    precision: year === null ? null : "year",
  };
}

describe("yearOf", () => {
  it("reads a bare year, and 0 as 1 BCE", () => {
    expect(yearOf(date(-1513))).to.equal(-1513);
    expect(yearOf(date(0))).to.equal(0);
  });

  it("places months and days inside the year", () => {
    expect(yearOf({ year: 33, month: 1, day: 1, approx: false })).to.equal(33);
    expect(yearOf({ year: 33, month: 7, day: null, approx: false })).to.be.closeTo(33.5, 0.01);
    // 14 Nisan 33 CE: part-way through the year, but still inside it.
    const nisan = yearOf({ year: 33, month: 1, day: 14, approx: false });
    expect(nisan).to.be.greaterThan(33);
    expect(nisan).to.be.lessThan(34);
  });
});

describe("formatYear", () => {
  it("says years the way a reader would", () => {
    expect(formatYear(33, ERAS)).to.equal("33 CE");
    expect(formatYear(-1512, ERAS)).to.equal("1513 BCE");
    // Astronomical 0 is 1 BCE; there is no year zero in the text.
    expect(formatYear(0, ERAS)).to.equal("1 BCE");
    expect(formatYear(32.7, ERAS)).to.equal("33 CE");
  });
});

describe("niceStep", () => {
  it("keeps at least five ticks across the span", () => {
    expect(niceStep(60000)).to.equal(10000);
    // 40000 / 10000 is only four ticks, so it drops to the next step down.
    expect(niceStep(40000)).to.equal(5000);
    expect(niceStep(600)).to.equal(100);
    expect(niceStep(3)).to.equal(1);
  });
});

describe("buildLanes", () => {
  const david = doc("david", "David");
  const flood = doc("flood", "The Flood", "event");

  it("pairs born/died into one span mark labelled by the Subject", () => {
    const lanes = buildLanes(
      [dated(david, "born", -1107), dated(david, "died", -1037)],
      [],
      "Events",
    );
    expect(lanes).to.have.length(1);
    expect(lanes[0].marks).to.have.length(1);
    const [m] = lanes[0].marks;
    expect(m.label).to.equal("David");
    expect(m.from).to.equal(-1107);
    expect(m.to).to.equal(-1037);
  });

  it("draws every other Date as a point labelled by its Property name", () => {
    const lanes = buildLanes(
      [
        dated(david, "born", -1107),
        dated(david, "died", -1037),
        dated(david, "anointed", -1077),
      ],
      [],
      "Events",
    );
    const anointed = lanes[0].marks.find((m) => m.label === "anointed");
    expect(anointed?.to).to.equal(null);
    expect(anointed?.from).to.equal(-1077);
  });

  it("leaves an unpaired born as a point, not a span", () => {
    const lanes = buildLanes([dated(david, "born", -1107)], [], "Events");
    expect(lanes[0].marks[0].to).to.equal(null);
    expect(lanes[0].marks[0].label).to.equal("born");
  });

  it("puts Events on their own Lane first, ahead of Subjects", () => {
    const lanes = buildLanes(
      [dated(flood, "start", -2370), dated(david, "born", -1107)],
      [],
      "Events",
    );
    expect(lanes.map((l) => l.id)).to.deep.equal(["events", "david"]);
    expect(lanes[0].title).to.equal("Events");
    expect(lanes[0].doc).to.equal(null);
  });

  it("omits the Events Lane when nothing dated is an Event", () => {
    const lanes = buildLanes([dated(david, "born", -1107)], [], "Events");
    expect(lanes.map((l) => l.id)).to.deep.equal(["david"]);
  });

  it("also draws an Event on the Lane of each Subject it names", () => {
    const lanes = buildLanes(
      [dated(flood, "start", -2370), dated(david, "born", -1107)],
      [{ event: "flood", subject: "david" }],
      "Events",
    );
    const dl = lanes.find((l) => l.id === "david")!;
    expect(dl.marks.map((m) => m.label)).to.include("The Flood");
    // The copy keeps its own key, so React does not see two marks as one.
    expect(new Set(dl.marks.map((m) => m.key)).size).to.equal(dl.marks.length);
  });

  it("ignores a link to a Subject or Event that is not dated", () => {
    const lanes = buildLanes(
      [dated(david, "born", -1107)],
      [{ event: "missing", subject: "david" }],
      "Events",
    );
    expect(lanes.find((l) => l.id === "david")!.marks).to.have.length(1);
  });

  it("drops Dates that did not parse, and Subjects left with none", () => {
    const lanes = buildLanes(
      [dated(david, "born", null), dated(doc("p", "Paul"), "born", 5)],
      [],
      "Events",
    );
    expect(lanes.map((l) => l.id)).to.deep.equal(["p"]);
  });

  it("orders Subject Lanes by earliest Date, then title", () => {
    const paul = doc("paul", "Paul");
    const abel = doc("abel", "Abel");
    const lanes = buildLanes(
      [dated(paul, "born", 5), dated(abel, "born", 5), dated(david, "born", -1107)],
      [],
      "Events",
    );
    expect(lanes.map((l) => l.id)).to.deep.equal(["david", "abel", "paul"]);
  });

  it("marks a span approximate when either end is", () => {
    const lanes = buildLanes(
      [dated(david, "born", -1107, true), dated(david, "died", -1037)],
      [],
      "Events",
    );
    expect(lanes[0].marks[0].approx).to.equal(true);
  });
});

describe("extentOf", () => {
  const david = doc("david", "David");

  it("pads the range it covers", () => {
    const lanes = buildLanes(
      [dated(david, "born", -1100), dated(david, "died", -1000)],
      [],
      "Events",
    );
    const [lo, hi] = extentOf(lanes);
    expect(lo).to.be.lessThan(-1100);
    expect(hi).to.be.greaterThan(-1000);
  });

  it("gives a lone point real width instead of a zero range", () => {
    const lanes = buildLanes([dated(david, "born", 33)], [], "Events");
    const [lo, hi] = extentOf(lanes);
    expect(hi - lo).to.be.greaterThan(9);
  });

  it("falls back when there is nothing dated at all", () => {
    expect(extentOf([])).to.deep.equal([-2000, 100]);
    expect(extentOf([], [0, 10])).to.deep.equal([0, 10]);
  });
});
