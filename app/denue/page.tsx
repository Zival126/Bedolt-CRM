import DenueSearch from "@/components/DenueSearch";
import { denueToken } from "@/lib/settings";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { loadMunicipios } from "@/lib/municipios";

export const dynamic = "force-dynamic";

export default async function Denue() {
  await requireSession("redirect");
  const data = loadMunicipios();
  return (
    <>
      <h1>Recherche DENUE</h1>
      {!denueToken() && <div className="banner bad" style={{ marginBottom: 12 }}>Token DENUE non configuré — <Link href="/reglages">Réglages &gt; DENUE</Link>.</div>}
      <DenueSearch municipios={data.municipios} entidad={data.entidad} />
    </>
  );
}
