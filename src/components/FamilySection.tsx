// A Character's Kinship on their Hub (CONTEXT.md, Kinship; ADR 0024; PLAN
// §32). Children, siblings and a spouse named only by the other side are
// derived (`src/lib/kinship.ts`). Editing (#152): Father and Mother are chosen
// with a Character picker and cleared, Spouses added and removed, all in this
// Character's own front matter; "Add child" writes the child's `father` or
// `mother`, never anything on this Character. Nothing is written but by a
// pick, a clear, a remove or Add child.
import { useCallback, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { CircleAlert, Network, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { api, type DocSummary, type DocumentPayload, type KinshipWarning } from "@/lib/api";
import {
  bareLink,
  checkAddChild,
  familyOf,
  kinGraph,
  parentRoleOf,
  withoutSpouse,
  withSpouse,
  writtenLinks,
  type ChildGroup,
  type KinGraph,
  type WrittenLink,
} from "@/lib/kinship";
import { joinFrontmatter, readField, removeField, setField, splitFrontmatter } from "@/lib/frontmatter";
import { live } from "@/lib/live";
import { useHasKin } from "@/lib/useHasKin";
import { useKinship } from "@/lib/useKinship";
import { useStore } from "@/lib/store";
import { propertyLabel, useT } from "@/i18n";
import type { Dict } from "@/i18n/en";
import { PanelTitle } from "@/components/Field";
import { TypeDot } from "@/components/DocLink";
import { DocPicker } from "@/components/Dialogs";
import { IconButton } from "@/components/IconButton";
import { PickerShell, TOUCH_TARGET } from "@/components/PickerShell";
import { Button } from "@/components/ui/button";

type Parent = "father" | "mother";

const CHARACTER: DocSummary["type"][] = ["character"];

/** How a Kinship Property names a Character: `[[Isaac]]`, as every link Property does. */
const linkTo = (d: DocSummary) => `[[${d.title}]]`;

/** A Kinship Property as written, each link with the Character it names, if any. */
async function resolveWritten(v: unknown): Promise<WrittenLink[]> {
  const texts = writtenLinks(v);
  if (texts.length === 0) return [];
  const docs = await api.resolveMany(texts.map(bareLink));
  return texts.map((text, i) => {
    const d = docs[i];
    return { text, doc: d ? { id: d.id, title: d.title } : null };
  });
}

/**
 * A remove or clear X beside a chip: a finger-sized hit area on a phone
 * (as `TOUCH_TARGET`), the glyph at its desktop size.
 */
const REMOVE_BUTTON = "size-10 shrink-0 text-muted-foreground md:size-6";

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

function Chips({
  docs,
  onRemove,
  removeLabel,
  children,
}: {
  docs: DocSummary[];
  /** Offered beside each chip `removeLabel` names; none where it returns null. */
  onRemove?: (d: DocSummary) => void;
  removeLabel?: (d: DocSummary) => string | null;
  /** After the chips, in the same wrapping line: the slot's own buttons. */
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {docs.map((d) => {
        const label = onRemove && removeLabel ? removeLabel(d) : null;
        return (
          <span key={d.id} className="inline-flex max-w-full min-w-0 items-center">
            <KinChip doc={d} />
            {label && (
              <IconButton
                label={label}
                size="icon-xs"
                data-testid="family-remove"
                data-id={d.id}
                className={REMOVE_BUTTON}
                onClick={() => onRemove!(d)}
              >
                <X />
              </IconButton>
            )}
          </span>
        );
      })}
      {children}
    </div>
  );
}

/** The Character picker: search by title or Alias, or "Create Character “X”" (template unchanged). */
function CharacterPicker({ exclude, onPick }: { exclude: Set<string>; onPick: (d: DocSummary) => void }) {
  const s = useStore();
  const t = useT();
  const filter = useCallback((d: DocSummary) => !exclude.has(d.id), [exclude]);
  return (
    <DocPicker
      types={CHARACTER}
      value=""
      testId="family-picker-input"
      placeholder={t.family.search}
      filter={filter}
      aliases
      inlineList
      autoFocus
      createLabel={t.family.create_character}
      // Only a pick writes: typing writes nothing.
      onChange={(_, d) => d && onPick(d)}
      onCreate={async (name) => {
        try {
          const created = await s.createDoc("character", name, undefined, undefined, false);
          onPick(created.summary);
        } catch (e) {
          toast.error(String(e));
        }
      }}
    />
  );
}

/** A labelled button opening the Character picker: a Popover, a bottom Sheet on a phone. */
function KinShell({
  testId,
  label,
  open,
  onOpenChange,
  trigger,
  children,
}: {
  testId: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <PickerShell label={label} testId="family-picker" open={open} onOpenChange={onOpenChange} trigger={trigger}>
      <div data-testid={`${testId}-picker`} className="grid min-w-0 gap-2">
        {children}
      </div>
    </PickerShell>
  );
}

/** The button opening a picker: wraps rather than widening its row (Locales). */
function ShellButton({
  testId,
  dashed,
  children,
  ...props
}: { testId: string; dashed?: boolean; children: ReactNode } & ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid={testId}
      className={cn("h-auto min-h-7 max-w-full text-left whitespace-normal", dashed && "border-dashed text-muted-foreground")}
      {...props}
    >
      {children}
    </Button>
  );
}

/** Father or Mother: the Character as a chip and a clear, or an empty slot reading "Choose…". */
function ParentSlot({
  role,
  kin,
  written,
  self,
  onChoose,
  onClear,
}: {
  role: Parent;
  kin: DocSummary | null;
  /** The file holds this Property, even one the section cannot read: it can be cleared. */
  written: boolean;
  self: string;
  onChoose: (d: DocSummary) => void;
  onClear: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const exclude = useMemo(() => new Set([self]), [self]);
  const label = role === "father" ? t.family.choose_father : t.family.choose_mother;
  return (
    <Chips docs={kin ? [kin] : []}>
      {!kin && (
        <span data-testid="family-empty" title={t.family.not_named} className="min-w-0">
          <KinShell
            testId={`family-${role}`}
            label={label}
            open={open}
            onOpenChange={setOpen}
            trigger={
              <ShellButton testId={`family-${role}-choose`} dashed aria-label={label}>
                {t.family.choose}
              </ShellButton>
            }
          >
            <CharacterPicker
              exclude={exclude}
              onPick={(d) => {
                setOpen(false);
                onChoose(d);
              }}
            />
          </KinShell>
        </span>
      )}
      {written && (
        <IconButton
          label={role === "father" ? t.family.clear_father : t.family.clear_mother}
          size="icon-xs"
          data-testid={`family-${role}-clear`}
          className={REMOVE_BUTTON}
          onClick={onClear}
        >
          <X />
        </IconButton>
      )}
    </Chips>
  );
}

/** "Add spouse": a Character added at the end of this Character's `spouses`. */
function AddSpouse({ exclude, onPick }: { exclude: Set<string>; onPick: (d: DocSummary) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <KinShell
      testId="family-add-spouse"
      label={t.family.add_spouse}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <ShellButton testId="family-add-spouse">
          <Plus />
          {t.family.add_spouse}
        </ShellButton>
      }
    >
      <CharacterPicker
        exclude={exclude}
        onPick={(d) => {
          setOpen(false);
          onPick(d);
        }}
      />
    </KinShell>
  );
}

type AddChildStep = { kind: "pick"; refused?: string } | { kind: "ask"; child: DocSummary };

/**
 * "Add child": pick or create the child, then write their `father` or
 * `mother`. Asked which the first time; afterwards the role this Character
 * already plays (`parentRoleOf`). A child with another parent is refused,
 * naming them, and nothing is written (`checkAddChild`).
 */
function AddChild({
  parent,
  graph,
  exclude,
}: {
  parent: DocSummary;
  graph: KinGraph;
  exclude: Set<string>;
}) {
  const t = useT();
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AddChildStep>({ kind: "pick" });
  const [busy, setBusy] = useState(false);
  const openChange = (o: boolean) => {
    setOpen(o);
    if (!o) setStep({ kind: "pick" });
  };

  const write = async (child: DocSummary, role: Parent) => {
    setBusy(true);
    try {
      // Typing in the child's own Pane lands first, so the check reads what it shows.
      await live.peek(child.id)?.flush();
      const file = await api.getDocument(child.id);
      const check = checkAddChild(await resolveWritten(file.frontmatter[role]), parent.id);
      if (check.kind === "refused") {
        const say = role === "father" ? t.family.refused_father : t.family.refused_mother;
        setStep({ kind: "pick", refused: say(child.title, check.existing) });
        return;
      }
      if (check.kind === "write") {
        const sp = splitFrontmatter(file.text);
        await api.saveDocument(child.id, joinFrontmatter(setField(sp.fm, role, linkTo(parent)), sp.body));
        await s.announceChanged([child.id]);
      }
      openChange(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = (child: DocSummary) => {
    const role = parentRoleOf(graph, parent.id);
    if (role) void write(child, role);
    else setStep({ kind: "ask", child });
  };

  return (
    <KinShell
      testId="family-add-child"
      label={t.family.add_child}
      open={open}
      onOpenChange={openChange}
      trigger={
        <ShellButton testId="family-add-child">
          <Plus />
          {t.family.add_child}
        </ShellButton>
      }
    >
      {step.kind === "ask" ? (
        <div data-testid="family-role-question" className="grid min-w-0 gap-2">
          <p className="min-w-0 text-sm break-words">{t.family.role_question(parent.title, step.child.title)}</p>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            {(["father", "mother"] as const).map((role) => (
              <Button
                key={role}
                type="button"
                variant="outline"
                disabled={busy}
                data-testid={`family-role-${role}`}
                className={cn(TOUCH_TARGET, "h-auto min-w-0 whitespace-normal")}
                onClick={() => void write(step.child, role)}
              >
                {role === "father" ? t.family.father : t.family.mother}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {step.refused && (
            <p
              data-testid="family-refused"
              role="alert"
              className="flex min-w-0 items-start gap-1.5 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{step.refused}</span>
            </p>
          )}
          <CharacterPicker exclude={exclude} onPick={pick} />
        </>
      )}
    </KinShell>
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

/**
 * The Hub header's "Show in Family tree" button (#155): the Family tree
 * focused on this Character. Only on a Character with kin: one with none
 * would open on an empty tree.
 */
export function FamilyTreeButton({ id, mtime }: { id: string; mtime: number }) {
  const s = useStore();
  const t = useT();
  const hasKin = useHasKin(id, { mtime });
  if (!hasKin) return null;
  return (
    <IconButton
      label={t.family_tree.show_in}
      data-testid="hub-family-tree"
      onClick={() => s.navigate({ kind: "family-tree", focus: id })}
    >
      <Network />
    </IconButton>
  );
}

export function FamilySection({
  doc,
  fm,
  onFmChange,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
}) {
  const t = useT();
  const id = doc.summary.id;
  // Any page can become, or stop being, the Character a link names: a
  // Character retyped to a Note leaves the type lists, so no list will do.
  const { data } = useKinship({ key: [id, doc.summary.mtime] });
  const graph = useMemo(() => (data ? kinGraph(data) : null), [data]);
  const family = useMemo(() => (graph ? familyOf(graph, id) : null), [graph, id]);
  // The spouses this Character's own file names: the ones it can remove.
  // A spouse named only by the other side is in the other file.
  const ownSpouses = useMemo(
    () =>
      new Set(
        (data?.edges ?? []).filter((e) => e.relation === "spouse" && e.character.id === id).map((e) => e.kin.id),
      ),
    [data, id],
  );
  const spouseExclude = useMemo(
    () => new Set([id, ...(family?.spouses ?? []).map((d) => d.id)]),
    [id, family],
  );
  const childExclude = useMemo(
    () => new Set([id, ...(graph?.children.get(id) ?? [])]),
    [id, graph],
  );
  if (!family || !graph) return null;

  // A Kinship Property as the live front matter holds it (what is shown and
  // written), the saved one only for a form `readField` does not take.
  const current = (key: string): unknown => {
    const v = readField(fm, key);
    return v === undefined ? doc.frontmatter[key] : v;
  };
  // Clear stays offered while either copy names someone: after a failed save
  // the slot still shows the indexed parent, and Clear retries.
  const written = (role: string) =>
    writtenLinks(current(role)).length > 0 || writtenLinks(doc.frontmatter[role]).length > 0;
  // Every write from this section: saved at once, and a failure said with a
  // toast besides the header's mark (the slots follow the index, so they stay
  // as they were).
  const write = async (next: string) => {
    onFmChange(next);
    const d = live.peek(id);
    if (!d) return;
    await d.flush();
    if (d.snapshot().status === "error") toast.error(t.family.save_failed, { id: "family-save-failed" });
  };
  const setSpouses = async (next: (current: WrittenLink[]) => string[] | null, touched: boolean) => {
    try {
      const value = next(await resolveWritten(current("spouses")));
      if (value === null && !touched) return;
      await write(setField(fm, "spouses", value));
    } catch (e) {
      toast.error(String(e));
    }
  };

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
        {(["father", "mother"] as const).map((role) => (
          <Row key={role} testid={`family-${role}`} label={t.family[role]}>
            <ParentSlot
              role={role}
              kin={family[role]}
              written={written(role)}
              self={id}
              onChoose={(d) => void write(setField(fm, role, linkTo(d)))}
              onClear={() => void write(removeField(fm, role))}
            />
          </Row>
        ))}
        {family.spouses.length > 0 && (
          <Row testid="family-spouses" label={t.family.spouses}>
            <Chips
              docs={family.spouses}
              onRemove={(d) => void setSpouses((cur) => withoutSpouse(cur, d.id), true)}
              removeLabel={(d) => (ownSpouses.has(d.id) ? t.family.remove_spouse(d.title) : null)}
            />
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
      {/* Shown even when Spouses and Children are empty: the way to start them. */}
      <div data-testid="family-actions" className="mt-3 flex min-w-0 flex-wrap gap-1.5">
        <AddSpouse
          exclude={spouseExclude}
          onPick={(d) => void setSpouses((cur) => withSpouse(cur, linkTo(d), d.id), false)}
        />
        <AddChild parent={doc.summary} graph={graph} exclude={childExclude} />
      </div>
    </section>
  );
}
