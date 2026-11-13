"use client";
export default function PrintButton() {
  return <button className="btn primary noprint" onClick={() => window.print()}>Imprimer / PDF</button>;
}
