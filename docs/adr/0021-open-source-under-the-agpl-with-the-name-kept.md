---
status: accepted
---

# Open source under the AGPL, with the name kept

Synesis is free, and the wish is that nobody turns it into a business. A licence that forbids commercial use (PolyForm Noncommercial) would say that outright, but it is not open source, and some people and distributions will not touch it. We decided on the GNU AGPL-3.0: anyone may use, change and share Synesis, and anyone who passes it on, sold or not, hosted or installed, must hand over the full source under the same licence. A closed paid edition is then impossible, and a sold copy can be given away free by whoever bought it, so selling one earns next to nothing. The network clause covers the web build as well as the apps.

The name and icon are kept apart from the code (`TRADEMARKS.md`): build and share Synesis as it is, but a changed version is not called Synesis and does not wear its icon. That stops a fork from being sold in an app store as if it were this app.

There is no paid tier either. The hosted, paid blob store that ADR 0001 and ADR 0008 kept for later is dropped: sync stays the user's own folder or Pairing, and a relay can be self-hosted. Promising "free forever" and charging for sync later would cost the trust the promise is for.

Code is by invitation, and whoever is invited signs a short agreement that lets the author relicense their contribution and publish it in app stores. Without it, every outside contributor would hold a veto over a licence change, and the App Store's terms, which conflict with the AGPL for third parties, could stop the author's own iOS builds.

## Considered options

- **PolyForm Noncommercial 1.0.0.** Forbids profit outright; rejected because it is not open source, and "free, source available" invites less trust than "open source".
- **MIT or Apache-2.0.** Rejected: a company could ship a closed, paid edition.
- **GPL-3.0.** Close, but a modified web build could be hosted without sharing its source.

## Consequences

- The AGPL discourages profit; it does not forbid it. Someone may still charge for installing it or for support, and that is allowed.
- Bundled data keeps its own terms (OpenBible.info under CC BY 4.0, Natural Earth, Mapzen Terrain Tiles), and their attribution stays in the app.
