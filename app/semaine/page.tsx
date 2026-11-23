import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";

// « Semaine » est devenue « Stats ».
export default async function Semaine() {
  await requireSession("redirect");
  redirect("/stats");
}
