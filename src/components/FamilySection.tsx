// A Character's Kinship on their Hub (CONTEXT.md, Kinship; ADR 0024; PLAN
// §32). Read-only in this part: `father`, `mother` and `spouses` are still
// edited as ordinary Property rows. Children, siblings and a spouse named only
// by the other side are derived (`src/lib/kinship.ts`); nothing is written.
import { useMemo, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { api, type DocSummary, type DocumentPayload, type KinshipWarning } from "@/lib/api";
import { familyOf, kinGraph, type ChildGroup } from "@/lib/kinship";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { propertyLabel, useT } from "@/i18n";
import type { Dict } from "@/i18n/en";
import { PanelTitle } from "@/components/Field";
import { TypeDot } from "@/components/DocLink";

/** One Character, as a chip that opens their Hub. Long names wrap. */
function KinChip({ doc }: { doc: DocSummary }) {
  const s = useStore();
  return (
    <button
      type="button"
      data-testid="family-kin"
      data-id={doc.id}
      onClick={s.openDocOnClick(doc.id)}
      title={doc.path}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <TypeDot type={doc.type} />
      <span className="min-w-0 break-words">{doc.label}</span>
    </button>
  );
}

function Chips({ docs }: { docs: DocSummary[] }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {docs.map((d) => (
        <KinChip key={d.id} doc={d} />
      ))}
    </div>
  );
}

/** A labelled row; label above its chips at every width, so a phone and a narrow pane read alike. */
function Row({ testid, label, children }: { testid: string; label: string; children: ReactNode }) {
  return (
    <div data-testid={testid} className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0">{children}</dd>
    </div>
  );
}

/** Under one subheading, the chips of a group (children by other parent, siblings by shared parents). */
function Group({ testid, heading, docs }: { testid: string; heading: string | null; docs: DocSummary[] }) {
  return (
    <div data-testid={testid} className="min-w-0">
      {heading && (
        <div data-testid={`${testid}-heading`} className="mb-1 text-xs break-words text-muted-foreground">
          {heading}
        </div>
      )}
      <Chips docs={docs} />
    </div>
  );
}

function childHeading(c: ChildGroup, t: Dict, only: boolean): string | null {
  if (c.other) return t.family.with_other(c.other.title);
  // Children with no other parent named stand under this one alone.
  if (only) return null;
  return c.otherRole === "mother" ? t.family.mother_not_named : t.family.father_not_named;
}

function warningText(w: KinshipWarning, t: Dict): string {
  switch (w.kind) {
    case "not_a_character":
      return t.family.warn_not_character(propertyLabel(w.property, t), w.target.title);
    case "two_values":
      return t.family.warn_two_values(propertyLabel(w.property, t), w.targets.join(", "));
    case "cycle":
      return t.family.warn_cycle(w.path.map((d) => d.title).join(" → "));
  }
}

export function FamilySection({ doc }: { doc: DocumentPayload }) {
  const t = useT();
  const id = doc.summary.id;
  const { data } = useQuery({
    key: ["kinship", id, doc.summary.mtime],
    // Any Topical page can become, or stop being, the Character a link names.
    deps: { types: ["character", "place", "concept", "event", "journey", "source", "other"] },
    fetch: () => api.kinship(),
  });
  const family = useMemo(() => (data ? familyOf(kinGraph(data), id) : null), [data, id]);
  if (!family) return null;
  const empty = (
    <span data-testid="family-empty" className="text-sm text-muted-foreground">
      {t.family.not_named}
    </span>
  );
  return (
    <section data-testid="hub-family" className="min-w-0">
      <PanelTitle className="mb-3">{t.family.title}</PanelTitle>
      {family.warnings.length > 0 && (
        <ul className="mb-3 space-y-1">
          {family.warnings.map((w, i) => (
            <li
              key={i}
              data-testid="family-warning"
              data-kind={w.kind}
              className="flex min-w-0 items-start gap-1.5 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{warningText(w, t)}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="grid min-w-0 gap-3">
        <Row testid="family-father" label={t.family.father}>
          {family.father ? <Chips docs={[family.father]} /> : empty}
        </Row>
        <Row testid="family-mother" label={t.family.mother}>
          {family.mother ? <Chips docs={[family.mother]} /> : empty}
        </Row>
        {family.spouses.length > 0 && (
          <Row testid="family-spouses" label={t.family.spouses}>
            <Chips docs={family.spouses} />
          </Row>
        )}
        {family.children.length > 0 && (
          <Row testid="family-children" label={t.family.children}>
            <div className="grid min-w-0 gap-2">
              {family.children.map((c) => (
                <Group
                  key={c.other?.id ?? `none-${c.otherRole}`}
                  testid="family-child-group"
                  heading={childHeading(c, t, family.children.length === 1)}
                  docs={c.children}
                />
              ))}
            </div>
          </Row>
        )}
        {family.siblings.length > 0 && (
          <Row testid="family-siblings" label={t.family.siblings}>
            <div className="grid min-w-0 gap-2">
              {family.siblings.map((s) => (
                <Group
                  key={s.parents.map((p) => p.id).join("|")}
                  testid="family-sibling-group"
                  heading={t.family.through(s.parents.map((p) => p.title).join(t.family.and))}
                  docs={s.siblings}
                />
              ))}
            </div>
          </Row>
        )}
      </dl>
    </section>
  );
}
