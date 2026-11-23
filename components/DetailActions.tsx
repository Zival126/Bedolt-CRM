"use client";
import { useRouter } from "next/navigation";
import ResultPanel, { type PanelItem } from "./ResultPanel";

// Boutons de résultat sur la fiche : même comportement que dans la file (toast + Annuler), puis rafraîchissement.
export default function DetailActions({ item }: { item: PanelItem }) {
  const router = useRouter();
  return <ResultPanel key={item.id + item.stage} item={item} onResolved={() => router.refresh()} />;
}
