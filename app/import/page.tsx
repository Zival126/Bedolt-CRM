import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";

// Ancienne adresse : l'import Excel vit désormais dans Sources.
export default async function Import() {
  await requireSession("redirect");
  redirect("/sources/excel");
}
