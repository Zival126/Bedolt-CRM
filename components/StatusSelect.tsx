"use client";
import { useTransition } from "react";
import { changeStatus } from "@/app/actions";
import { STATUTS } from "@/lib/constants";

export default function StatusSelect({ id, value }: { id: number; value: string }) {
  const [pending, start] = useTransition();
  return (
    <select value={value} disabled={pending} onChange={(e) => start(() => changeStatus(id, e.target.value))} style={{ minHeight: 36, width: "auto" }}>
      {STATUTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  );
}
