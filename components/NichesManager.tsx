"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { NicheIcon, NicheBadge, Empty, fmtN } from "./ui";
import { MoreMenu } from "./Drawer";
import ActivityPicker from "./denue/ActivityPicker";
import { PALETTE, NICHE_ICONS, isHexColor } from "@/lib/niche-style";
import type { NicheRow, NicheStat } from "@/lib/niches";

type Stats = Record<number, NicheStat>;
type Res = { niches: NicheRow[]; stats: Stats; id?: number; moved?: number; changed?: number; matched?: number };

export default function NichesManager({ initial, stats: s0, titles, auto: auto0, osmTags, overtureCats }: {
  initial: NicheRow[]; stats: Stats; titles: Record<string, string>; auto: number; osmTags: string[]; overtureCats: string[];
}) {
  const router = useRouter();
  const [niches, setNiches] = useState(initial);
  const [stats, setStats] = useState(s0);
  const [auto, setAuto] = useState(auto0);
  const [edit, setEdit] = useState<NicheRow | "new" | null>(null);
  const [merge, setMerge] = useState<NicheRow | null>(null);
  const [showArch, setShowArch] = useState(false);
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(body: object, ok?: (r: Res) => string) {
    setBusy(true);
    try {
      const r = await postJson<Res>("/api/niches", body);
      setNiches(r.niches); setStats(r.stats);
      if (ok) toast(ok(r));
      router.refresh();
      return r;
    } catch (e) { toastError(e); return null; } finally { setBusy(false); }
  }
  const byCount = (a: NicheRow, b: NicheRow) => (stats[b.id]?.fiches ?? 0) - (stats[a.id]?.fiches ?? 0) || a.label.localeCompare(b.label, "fr");
  const active = niches.filter((n) => !n.archived).sort(byCount), archived = niches.filter((n) => n.archived);
  const none = stats[0]?.fiches ?? 0;

  async function runAuto() {
    const r = await call({ action: "auto", apply: true }, (x) => `${fmtN(x.matched ?? 0)} fiche(s) classée(s) automatiquement.`);
    if (r) setAuto(0);
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row spread">
        <b>{active.length} niche{active.length > 1 ? "s" : ""} active{active.length > 1 ? "s" : ""}</b>
        <button type="button" className="btn primary" onClick={() => setEdit("new")}>+ Créer une niche</button>
      </div>

      {none > 0 && (
        <div className="card stack" style={{ gap: 10, borderStyle: "dashed" }}>
          <div className="row spread"><span><NicheBadge n={null} /> <b>{fmtN(none)}</b> fiche{none > 1 ? "s" : ""} sans niche <span className="small muted">(leur spécialité est gardée)</span></span>
            <Link href="/commerces?vue=toutes&n=0" className="btn sm">Voir ces fiches</Link></div>
          <div className="row">
            {auto > 0 && <button type="button" className="btn sm primary-soft" disabled={busy} onClick={runAuto}>Classer automatiquement ({fmtN(auto)} reconnues)</button>}
            <select value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Niche à attribuer" style={{ width: "auto", minWidth: 180 }}>
              <option value="">Choisir une niche…</option>{active.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
            <button type="button" className="btn sm" disabled={!bulk || busy} onClick={() => confirm(`Attribuer « ${active.find((n) => n.id === Number(bulk))?.label} » aux ${none} fiches sans niche ?`)
              && call({ action: "assign", niche: Number(bulk), query: "vue=toutes&n=0" }, (r) => `${fmtN(r.changed ?? 0)} fiche(s) mise(s) à jour.`)}>Attribuer à toutes</button>
          </div>
          <span className="tiny muted">« Classer automatiquement » utilise la catégorie OSM / Overture, le code d'activité DENUE ou les mots-clés de chaque niche. Pour choisir fiche par fiche : « Voir ces fiches », coche-les puis « Changer la niche ».</span>
        </div>
      )}

      <div className="niche-list">
        {active.length === 0 && <Empty title="Aucune niche">Crée ta première niche (ex. « Beauté », « Barbiers »).</Empty>}
        {active.map((n) => <Card key={n.id} n={n} st={stats[n.id]} onEdit={() => setEdit(n)} onMerge={() => setMerge(n)}
          onArchive={() => call({ action: "update", id: n.id, niche: {}, archived: true }, () => `« ${n.label} » archivée.`)} />)}
      </div>

      {archived.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <button type="button" className="link small" onClick={() => setShowArch(!showArch)}>{showArch ? "▾" : "▸"} Niches archivées ({archived.length})</button>
          {showArch && <div className="niche-list">{archived.map((n) => <Card key={n.id} n={n} st={stats[n.id]} onEdit={() => setEdit(n)} onMerge={() => setMerge(n)}
            onArchive={() => call({ action: "update", id: n.id, niche: {}, archived: false }, () => `« ${n.label} » réactivée.`)} />)}</div>}
        </div>
      )}

      {edit && <Editor n={edit === "new" ? null : edit} titles={titles} osmTags={osmTags} overtureCats={overtureCats} busy={busy} onClose={() => setEdit(null)}
        used={active.map((x) => x.color)}
        onSave={async (data, maps) => {
          let id = edit === "new" ? 0 : edit.id;
          if (edit === "new") { const r = await call({ action: "create", niche: data }); if (!r?.id) return; id = r.id; }
          else if (!(await call({ action: "update", id, niche: data }))) return;
          for (const [kind, values] of Object.entries(maps)) if (values) await call({ action: "maps", id, kind, values });
          toast(edit === "new" ? `Niche « ${data.label} » créée.` : "Niche enregistrée ✓");
          setEdit(null);
        }} />}

      {merge && (
        <div className="modal" onClick={() => setMerge(null)}>
          <div className="card stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Fusionner">
            <b>Fusionner « {merge.label} » dans…</b>
            <p className="small muted" style={{ margin: 0 }}>Les {fmtN(stats[merge.id]?.fiches ?? 0)} fiche(s) et les correspondances de « {merge.label} » passent dans la niche choisie. « {merge.label} » est ensuite supprimée (son nom devient un mot-clé).</p>
            <div className="nchips">{active.filter((x) => x.id !== merge.id).map((x) => (
              <button key={x.id} type="button" className="nchip" style={{ "--n": x.color } as React.CSSProperties} disabled={busy}
                onClick={() => confirm(`Fusionner « ${merge.label} » dans « ${x.label} » ?`) && call({ action: "merge", from: merge.id, into: x.id }, (r) => `${fmtN(r.moved ?? 0)} fiche(s) déplacée(s) vers « ${x.label} ».`).then((r) => r && setMerge(null))}>
                <NicheIcon icon={x.icon} />{x.label}</button>))}</div>
            <div><button type="button" className="btn ghost" onClick={() => setMerge(null)}>Annuler</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ n, st, onEdit, onMerge, onArchive }: { n: NicheRow; st?: NicheStat; onEdit: () => void; onMerge: () => void; onArchive: () => void }) {
  const maps = [n.scian.length && `${n.scian.length} SCIAN`, n.osm.length && `${n.osm.length} OSM`, n.overture.length && `${n.overture.length} Overture`, n.keywords.length && `${n.keywords.length} mot(s)-clé(s)`].filter(Boolean).join(" · ");
  return (
    <div className={"niche-card" + (n.archived ? " arch" : "")} style={{ "--n": n.color } as React.CSSProperties}>
      <span className="niche-ico"><NicheIcon icon={n.icon} size={22} /></span>
      <Link href={`/commerces?vue=toutes&n=${n.id}`} style={{ minWidth: 0, color: "inherit" }} title="Voir les fiches de cette niche">
        <div className="t">{n.label}{n.archived && <span className="badge" style={{ marginLeft: 6 }}>archivée</span>}
          {(st?.fiches ?? 0) > 0 && (st?.fiches ?? 0) < 3 && <span className="nb-warn" style={{ marginLeft: 6 }} title="Moins de 3 fiches : sans doute une spécialité">fusionner ?</span>}</div>
        {n.description && <div className="small muted">{n.description}</div>}
        <div className="niche-nums"><span><b>{fmtN(st?.fiches ?? 0)}</b> fiches</span><span><b>{fmtN(st?.contactees ?? 0)}</b> contactées</span>
          <span><b>{fmtN(st?.reponses ?? 0)}</b> réponses</span><span><b>{fmtN(st?.clients ?? 0)}</b> clients</span></div>
        {maps && <div className="tiny muted" style={{ marginTop: 2 }}>Reconnue par : {maps}</div>}
      </Link>
      <div className="row acts" style={{ flexWrap: "nowrap" }}>
        <button type="button" className="btn sm" onClick={onEdit}>Modifier</button>
        <MoreMenu>
          <Link href={`/commerces?vue=toutes&n=${n.id}`}>Voir les fiches</Link>
          <Link href={`/carte?n=${n.id}`}>Voir sur la carte</Link>
          <button type="button" onClick={onMerge}>Fusionner dans une autre niche…</button>
          <button type="button" onClick={onArchive}>{n.archived ? "Réactiver" : "Archiver"}</button>
        </MoreMenu>
      </div>
    </div>
  );
}

type Maps = { scian?: string[]; osm?: string[]; overture?: string[]; keyword?: string[] };
function Editor({ n, titles, osmTags, overtureCats, busy, used, onClose, onSave }: {
  n: NicheRow | null; titles: Record<string, string>; osmTags: string[]; overtureCats: string[]; busy: boolean; used: string[];
  onClose: () => void; onSave: (d: { label: string; color: string; icon: string; description: string }, maps: Maps) => void;
}) {
  const free = PALETTE.find(([c]) => !used.includes(c))?.[0] ?? PALETTE[0][0];
  const [d, setD] = useState({ label: n?.label ?? "", color: n?.color ?? free, icon: n?.icon ?? "tag", description: n?.description ?? "" });
  const [tab, setTab] = useState<"scian" | "osm" | "overture" | "keyword">("keyword");
  const [maps, setMaps] = useState<Required<Maps>>({ scian: n?.scian ?? [], osm: n?.osm ?? [], overture: n?.overture ?? [], keyword: n?.keywords ?? [] });
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const setM = (k: keyof Maps, v: string[]) => { setMaps((m) => ({ ...m, [k]: v })); setTouched((t) => new Set(t).add(k)); };
  const changed: Maps = Object.fromEntries([...touched].map((k) => [k, maps[k as keyof Maps]]));
  return (
    <div className="modal" onClick={onClose}>
      <div className="card stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={n ? `Modifier ${n.label}` : "Nouvelle niche"} style={{ "--n": d.color } as React.CSSProperties}>
        <div className="row spread"><b style={{ fontSize: 17 }}>{n ? "Modifier la niche" : "Nouvelle niche"}</b><NicheBadge n={{ id: n?.id ?? -1, label: d.label || "Aperçu", color: d.color, icon: d.icon }} /></div>
        <label className="f">Nom<input value={d.label} maxLength={60} onChange={(e) => setD({ ...d, label: e.target.value })} placeholder="ex. Barbiers" autoFocus /></label>
        <label className="f">Description courte (facultatif)<input value={d.description} maxLength={200} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="ex. Barberías et salons pour hommes" /></label>
        <div className="stack" style={{ gap: 6 }}><span className="small muted">Couleur</span>
          <div className="swatches">
            {PALETTE.map(([c, l]) => <button key={c} type="button" className={"swatch" + (d.color === c ? " on" : "")} style={{ "--n": c } as React.CSSProperties} title={l} aria-label={`Couleur ${l}`} aria-pressed={d.color === c} onClick={() => setD({ ...d, color: c })} />)}
            <label className="swatch-free" title="Couleur libre"><span className="sr-only">Couleur libre</span><input type="color" value={isHexColor(d.color) ? d.color : "#94a3b8"} onChange={(e) => setD({ ...d, color: e.target.value })} /></label>
          </div></div>
        <div className="stack" style={{ gap: 6 }}><span className="small muted">Icône</span>
          <div className="icons">{Object.entries(NICHE_ICONS).map(([k, [l]]) => <button key={k} type="button" className={d.icon === k ? "on" : ""} title={l} aria-label={`Icône ${l}`} aria-pressed={d.icon === k} onClick={() => setD({ ...d, icon: k })}><NicheIcon icon={k} size={20} /></button>)}</div></div>

        <div className="stack" style={{ gap: 8 }}>
          <span className="small muted">Reconnaître automatiquement cette niche</span>
          <div className="tabs sub" style={{ margin: 0 }}>
            {([["keyword", "Mots-clés Excel"], ["scian", "DENUE (SCIAN)"], ["osm", "OpenStreetMap"], ["overture", "Overture"]] as const).map(([k, l]) =>
              <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l} ({maps[k].length})</button>)}
          </div>
          {tab === "keyword" && <><TagEdit values={maps.keyword} onChange={(v) => setM("keyword", v)} placeholder="ex. barberia, barber shop" />
            <span className="tiny muted">Textes de la colonne « Niche » d'un fichier qui doivent aller dans cette niche (accents et majuscules ignorés).</span></>}
          {tab === "scian" && <ActivityPicker value={maps.scian.map((c) => ({ code: c, title: titles[c] ?? "" }))} onChange={(c) => setM("scian", c.map((x) => x.code))} niches={[]} />}
          {tab === "osm" && <><TagEdit values={maps.osm} onChange={(v) => setM("osm", v)} suggestions={osmTags} placeholder="clé=valeur (ex. shop=hairdresser)" valid={(v) => /^!?[a-z_]+=[a-z0-9_;:-]+$/.test(v)} />
            <span className="tiny muted">Ces tags servent aussi à la recherche OpenStreetMap de cette niche. « ! » devant = exclure.</span></>}
          {tab === "overture" && <><TagEdit values={maps.overture} onChange={(v) => setM("overture", v)} suggestions={overtureCats} placeholder="catégorie (ex. nail_salon, *barber*)" valid={(v) => /^!?[a-z0-9_*]{2,80}$/.test(v)} />
            <span className="tiny muted">« * » = n'importe quel texte (ex. <code>*dental*</code>), « ! » devant = exclure.</span></>}
        </div>
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !d.label.trim()} onClick={() => onSave({ ...d, label: d.label.trim(), description: d.description.trim() }, changed)}>{n ? "Enregistrer" : "Créer la niche"}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}

function TagEdit({ values, onChange, suggestions, placeholder, valid = (v) => v.trim().length >= 2 }: {
  values: string[]; onChange: (v: string[]) => void; suggestions?: string[]; placeholder: string; valid?: (v: string) => boolean;
}) {
  const [q, setQ] = useState("");
  const id = "dl-" + placeholder.length;
  const add = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (!v) return;
    if (!valid(v)) return toast("Valeur non reconnue : " + v, { kind: "err" });
    if (!values.includes(v)) onChange([...values, v]);
    setQ("");
  };
  return (
    <div className="tagedit">
      {values.map((v) => <span key={v} className={"tag-x" + (v.startsWith("!") ? " ex" : "")}><code>{v}</code><button type="button" aria-label={`Retirer ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button></span>)}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} list={suggestions ? id : undefined} aria-label={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(q); } }} onBlur={() => q && add(q)} />
      {suggestions && <datalist id={id}>{suggestions.filter((s) => !values.includes(s)).slice(0, 300).map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}
