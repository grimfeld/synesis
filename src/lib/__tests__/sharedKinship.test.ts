import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangedPayload, Kinship } from "../api";

const kinship = vi.fn<() => Promise<Kinship>>();
vi.mock("../api", () => ({ api: { kinship: () => kinship() } }));
const { sharedKinship } = await import("../sharedKinship");

const answer = (): Kinship => ({ edges: [], warnings: [], relations: [] });
function pending() {
  let resolve!: (k: Kinship) => void;
  const p = new Promise<Kinship>((r) => (resolve = r));
  return { p, resolve };
}

describe("sharedKinship", () => {
  beforeEach(() => {
    kinship.mockReset();
  });

  it("joins the requests asked after the same change while one is in flight", async () => {
    const one = pending();
    kinship.mockReturnValueOnce(one.p);
    const change: ChangedPayload = { changed: [], removed: [] };
    const a = sharedKinship(change);
    const b = sharedKinship(change);
    expect(kinship).toHaveBeenCalledTimes(1);
    one.resolve(answer());
    expect(await a).toBe(await b);
  });

  it("asks again after a new change, even with one in flight", () => {
    kinship.mockReturnValue(pending().p);
    sharedKinship({ changed: [], removed: [] });
    sharedKinship({ changed: [], removed: [] });
    expect(kinship).toHaveBeenCalledTimes(2);
  });

  it("never hands out a settled answer", async () => {
    const change: ChangedPayload = { changed: [], removed: [] };
    kinship.mockResolvedValueOnce(answer()).mockResolvedValueOnce(answer());
    await sharedKinship(change);
    await sharedKinship(change);
    expect(kinship).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failure", async () => {
    const change: ChangedPayload = { changed: [], removed: [] };
    kinship.mockRejectedValueOnce(new Error("no")).mockResolvedValueOnce(answer());
    await expect(sharedKinship(change)).rejects.toThrow("no");
    await expect(sharedKinship(change)).resolves.toEqual(answer());
  });
});
