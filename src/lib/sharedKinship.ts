// One engine call for every Kinship query asked after the same Vault change
// (src/lib/useKinship.ts). No React, so tested on its own.
import { api, type ChangedPayload, type Kinship } from "./api";

// The one request in flight, and the change it was asked after. Only while in
// flight: a settled answer is never handed out, so nothing outlives a Vault
// switch or a change.
let inFlight: { after: ChangedPayload | null; answer: Promise<Kinship> } | null = null;

/** `api.kinship()`, joined with a request already in flight since the same change. */
export function sharedKinship(after: ChangedPayload | null): Promise<Kinship> {
  if (inFlight && inFlight.after === after) return inFlight.answer;
  const answer = api.kinship();
  const mine = { after, answer };
  inFlight = mine;
  const done = () => {
    if (inFlight === mine) inFlight = null;
  };
  answer.then(done, done);
  return answer;
}
