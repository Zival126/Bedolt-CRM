import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import type { SP } from "@/lib/filters";

// Ancienne adresse : DENUE vit désormais dans Sources (mêmes paramètres : mode, lat, lng, codes, municipio, tab…).
export default async function Denue({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("redirect");
  const p = new URLSearchParams({ src: "denue" });
  for (const [k, v] of Object.entries(await searchParams)) { const x = Array.isArray(v) ? v[0] : v; if (x && k !== "src") p.set(k, x.slice(0, 200)); }
  redirect("/sources?" + p.toString());
}
