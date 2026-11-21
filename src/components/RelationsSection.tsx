// A Character's Relations on their Hub (CONTEXT.md, Relation; PLAN §32): the
// links to other Characters that are not Kinship, each named by the user in a
// link Property of their own word (`mentor: "[[Elijah]]"`). Shown both ways,
// "mentor: Elijah" on Elisha and "mentor of: Elisha" on Elijah. Read-only:
// a Relation is an ordinary Property, edited in Properties.
import { useMemo } from "react";
import type { DocumentPayload } from "@/lib/api";
import { relationsOf } from "@/lib/kinship";
import { useKinship } from "@/lib/useKinship";
import { propertyLabel, useT } from "@/i18n";
import { PanelTitle } from "@/components/Field";
import { DocLink } from "@/components/DocLink";

export function RelationsSection({ doc }: { doc: DocumentPayload }) {
  const t = useT();
  const id = doc.summary.id;
  const { data } = useKinship({ key: [id, doc.summary.mtime] });
  const rows = useMemo(() => (data ? relationsOf(data, id) : []), [data, id]);
  if (rows.length === 0) return null;
  return (
    <section data-testid="hub-relations" className="min-w-0">
      <PanelTitle className="mb-3">{t.relations.title}</PanelTitle>
      <ul className="space-y-1">
        {rows.map((r) => {
          const label = propertyLabel(r.property, t);
          return (
            <li
              key={`${r.inverse ? "in" : "out"}:${r.property}:${r.other.id}`}
              data-testid="hub-relation"
              data-property={r.property}
              data-direction={r.inverse ? "in" : "out"}
              data-id={r.other.id}
              className="flex min-w-0 flex-wrap items-center gap-x-1"
            >
              <span
                data-testid="hub-relation-label"
                className="min-w-0 break-words pl-2 text-sm text-muted-foreground"
              >
                {r.inverse ? t.relations.named_by(label) : t.relations.named(label)}
              </span>
              <div className="min-w-0 flex-1 basis-32">
                <DocLink doc={r.other} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
