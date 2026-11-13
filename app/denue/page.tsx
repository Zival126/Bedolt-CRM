import data from "@/data/municipios-qroo.json";
import DenueSearch from "@/components/DenueSearch";
import { denueToken } from "@/lib/settings";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function Denue() {
  return (
    <>
      <h1>Recherche DENUE</h1>
      {!denueToken() && <div className="banner bad" style={{ marginBottom: 12 }}>Token DENUE non configuré — <Link href="/reglages">Réglages &gt; DENUE</Link>.</div>}
      <DenueSearch municipios={data.municipios} entidad={data.entidad} />
    </>
  );
}
