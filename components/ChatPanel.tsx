"use client";
import { useEffect, useRef, useState } from "react";

type Proposal = { id: string; summary: string; status: "pending" | "applied" | "rejected" };
type Message = { id?: number; role: "user" | "assistant"; content: string; proposals?: Proposal[] };

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [conv, setConv] = useState<number | undefined>();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [list, setList] = useState<{ id: number; title: string }[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);
  useEffect(() => {
    if (!open) return;
    fetch("/api/ai/status").then((r) => r.json()).then((s) => setOnline(s.online)).catch(() => setOnline(false));
  }, [open]);

  async function openConv(id?: number) {
    setList(null); setConv(id); setMsgs([]);
    if (id) setMsgs((await (await fetch(`/api/chat/history?id=${id}`)).json()).messages);
  }
  async function showHistory() { setList((await (await fetch("/api/chat/history")).json()).conversations); }
  async function delConv(id: number) {
    await fetch(`/api/chat/history?id=${id}`, { method: "DELETE" });
    showHistory();
    if (id === conv) { setConv(undefined); setMsgs([]); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setBusy(true); setTool("");
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    const patchLast = (f: (m: Message) => Message) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? f(m) : m)));
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conv, message: text }) });
      if (!res.ok || !res.body) throw new Error("Erreur " + res.status);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.t === "conv") setConv(ev.id);
          else if (ev.t === "token") patchLast((m) => ({ ...m, content: m.content + ev.v }));
          else if (ev.t === "tool") setTool(ev.name);
          else if (ev.t === "error") { setOnline(ev.v !== "IA hors ligne"); patchLast((m) => ({ ...m, content: m.content || "⚠️ " + ev.v })); }
          else if (ev.t === "proposals") patchLast((m) => ({ ...m, id: ev.messageId, proposals: ev.items }));
        }
      }
    } catch (err) {
      patchLast((m) => ({ ...m, content: "⚠️ " + (err as Error).message }));
    }
    setBusy(false); setTool("");
  }

  async function decide(m: Message, p: Proposal, action: "apply" | "reject") {
    const r = await fetch("/api/chat/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: m.id, proposalId: p.id, action }) });
    const j = await r.json();
    if (!r.ok) return alert(j.error);
    setMsgs((all) => all.map((x) => (x === m ? { ...x, proposals: x.proposals?.map((q) => (q.id === p.id ? { ...q, status: j.status } : q)) } : x)));
  }

  if (!open) return <button className="fab noprint" onClick={() => setOpen(true)} aria-label="Ouvrir le chat IA">✦</button>;
  return (
    <div className="chat noprint">
      <header>
        <strong style={{ flex: 1 }}>Assistant IA <span className={"dot" + (online ? " on" : "")} title={online ? "Connecté" : "Hors ligne"} /></strong>
        <button className="btn sm" onClick={() => openConv()}>Nouveau</button>
        <button className="btn sm" onClick={showHistory}>Historique</button>
        <button className="btn sm" onClick={() => setOpen(false)}>✕</button>
      </header>
      {list ? (
        <div className="msgs">
          {list.length === 0 && <p className="muted">Aucune conversation.</p>}
          {list.map((c) => (
            <div key={c.id} className="row">
              <button className="btn" style={{ flex: 1, justifyContent: "flex-start", overflow: "hidden" }} onClick={() => openConv(c.id)}>{c.title}</button>
              <button className="btn sm danger" onClick={() => delConv(c.id)}>Suppr.</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="msgs">
          {online === false && <div className="banner bad">IA hors ligne — le CRM fonctionne normalement.</div>}
          {msgs.length === 0 && <p className="muted small">Ex. « classe les commerces de Puerto Morelos par priorité », « lesquels n'ont pas de fiche Google et ont un téléphone ? », « résume mes relances de la semaine ».</p>}
          {msgs.map((m, i) => (
            <div key={i} className={"bubble " + m.role}>
              {m.content || (busy && i === msgs.length - 1 ? (tool ? `… ${tool}` : "…") : "")}
              {m.proposals?.map((p) => (
                <div key={p.id} className="proposal">
                  <div>{p.summary}</div>
                  {p.status === "pending" ? (
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="btn sm primary" onClick={() => decide(m, p, "apply")}>Appliquer</button>
                      <button className="btn sm" onClick={() => decide(m, p, "reject")}>Ignorer</button>
                    </div>
                  ) : <span className={"badge " + (p.status === "applied" ? "ok" : "")}>{p.status === "applied" ? "Appliqué" : "Ignoré"}</span>}
                </div>
              ))}
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      <form onSubmit={send}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Écris à l'IA…" />
        <button className="btn primary" disabled={busy}>Envoyer</button>
      </form>
    </div>
  );
}
