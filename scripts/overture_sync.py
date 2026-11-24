#!/usr/bin/env python3
"""Overture Maps Places → table SQLite overture_places (bbox Quintana Roo uniquement, jamais le monde entier).

Lancé par scripts/overture-sync.sh : module DuckDB de .venv-overture, ou binaire CLI officiel (--duckdb-cli) en repli.
1. Version : la plus récente du catalogue officiel (https://stac.overturemaps.org/catalog.json), ou --release.
2. Lecture distante des fichiers Parquet publics (s3://overturemaps-us-west-2, sans compte) : DuckDB ne télécharge
   que les blocs dont la bbox recoupe la zone (statistiques Parquet) → quelques dizaines de Mo, pas les ~10 Go mondiaux.
3. Écriture d'un fichier NDJSON temporaire dans data/overture/, chargement dans SQLite en une transaction
   (remplace le contenu précédent), puis suppression du fichier temporaire.
Données : Overture Maps Foundation (licences CDLA Permissive 2.0 / ODbL selon les sources).
"""
import argparse, gzip, json, os, sqlite3, subprocess, sys, time, urllib.request

QROO = (-89.5, 17.8, -86.65, 21.7)  # xmin, ymin, xmax, ymax — même cadre que lib/geo.ts (QROO_BOX)
STAC = "https://stac.overturemaps.org/catalog.json"
UA = "BedoltCRM/1.0 (contacto@bedolt.com)"

DDL = """
CREATE TABLE IF NOT EXISTS overture_places (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', basic_category TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '', phones TEXT NOT NULL DEFAULT '[]', websites TEXT NOT NULL DEFAULT '[]', socials TEXT NOT NULL DEFAULT '[]',
  emails TEXT NOT NULL DEFAULT '[]', address TEXT NOT NULL DEFAULT '', locality TEXT NOT NULL DEFAULT '', postcode TEXT NOT NULL DEFAULT '',
  confidence REAL, operating_status TEXT NOT NULL DEFAULT '', lat REAL, lng REAL, release TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS overture_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""


def latest_release() -> str:
    req = urllib.request.Request(STAC, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["latest"]


class PyEngine:
    """Module Python duckdb (.venv-overture)."""
    def __init__(self):
        import duckdb
        self.version = duckdb.__version__
        self.con = duckdb.connect()

    def run(self, sql: str):
        return self.con.execute(sql).fetchall()


class CliEngine:
    """Binaire CLI officiel (repli) : chaque appel rejoue les réglages de session puis la requête."""
    def __init__(self, path: str):
        self.path = path
        out = subprocess.run([path, "-version"], capture_output=True, text=True, timeout=30)
        self.version = out.stdout.split()[0].lstrip("v") if out.stdout else "?"
        self.setup = []

    def run(self, sql: str):
        script = "".join(s.rstrip(";") + ";\n" for s in self.setup + [sql])
        r = subprocess.run([self.path, "-batch", "-json", ":memory:"], input=script, capture_output=True, text=True, timeout=3600)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout).strip()[-800:])
        # Sortie -json : un tableau JSON par requête qui renvoie des lignes ; on garde le dernier.
        rows, dec, i, out = [], json.JSONDecoder(), 0, r.stdout
        while True:
            j = out.find("[", i)
            if j < 0:
                break
            block, i = dec.raw_decode(out, j)
            rows = [tuple(x.values()) for x in block]
        return rows

    def session(self, sql: str):
        self.setup.append(sql)


def session(eng, sql: str):
    if isinstance(eng, CliEngine):
        eng.session(sql)
    eng.run(sql)


def load_extensions(eng, ext_dir: str):
    """httpfs (lecture S3) et spatial (géométries). Si l'installation directe échoue (pas d'accès à
    extensions.duckdb.org en HTTP), téléchargement HTTPS puis installation depuis le fichier ; DuckDB vérifie la
    signature de l'extension au chargement (une extension non signée est refusée)."""
    session(eng, f"SET extension_directory='{ext_dir}'")
    platform = eng.run("PRAGMA platform")[0][0]
    for ext in ("httpfs", "spatial"):
        try:
            eng.run(f"INSTALL {ext}")
        except Exception as e:  # noqa: BLE001
            url = f"https://extensions.duckdb.org/v{eng.version}/{platform}/{ext}.duckdb_extension.gz"
            local = os.path.join(ext_dir, f"{ext}-{eng.version}.duckdb_extension")
            print(f"  extension {ext} : installation directe impossible ({str(e).splitlines()[0][:120]}), téléchargement HTTPS…", flush=True)
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=300) as r, open(local, "wb") as f:
                f.write(gzip.decompress(r.read()))
            eng.run(f"INSTALL '{local}'")
        session(eng, f"LOAD {ext}")


def extract(release: str, bbox, out: str, ext_dir: str, cli: str = ""):
    eng = CliEngine(cli) if cli else PyEngine()
    print(f"  DuckDB {eng.version} ({'cli ' + cli if cli else 'python'})", flush=True)
    os.makedirs(ext_dir, exist_ok=True)
    load_extensions(eng, ext_dir)
    session(eng, "SET s3_region='us-west-2'")
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:  # environnement derrière un proxy (pas le cas du VPS)
        session(eng, f"SET http_proxy='{proxy.split('://')[-1]}'")
        ca = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
        if ca:
            session(eng, f"SET ca_cert_file='{ca}'")
    src = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*.parquet"
    cols = {r[0] for r in eng.run(f"DESCRIBE SELECT * FROM read_parquet('{src}')")}
    cat = 'taxonomy."primary"' if "taxonomy" in cols else 'categories."primary"'
    alts = "list_concat(coalesce(taxonomy.hierarchy, []), coalesce(taxonomy.alternates, []))" if "taxonomy" in cols else "coalesce(categories.alternate, [])"
    basic = "basic_category" if "basic_category" in cols else "''"
    status = "operating_status" if "operating_status" in cols else "NULL"
    xmin, ymin, xmax, ymax = bbox
    # Position : point de la géométrie (extension spatial) ; centre de la bbox si la géométrie n'est pas un point
    pt = "CASE WHEN ST_GeometryType(geometry)::VARCHAR = 'POINT' THEN {f}(geometry) ELSE {b} END"
    eng.run(f"""COPY (SELECT id, names."primary" AS name, {cat} AS category, {basic} AS basic_category, {alts} AS alts,
        confidence, {status} AS operating_status, websites, emails, socials, phones, addresses,
        {pt.format(f="ST_X", b="(bbox.xmin + bbox.xmax) / 2")} AS lng, {pt.format(f="ST_Y", b="(bbox.ymin + bbox.ymax) / 2")} AS lat
      FROM read_parquet('{src}', hive_partitioning = 0)
      WHERE bbox.xmin >= {xmin} AND bbox.xmax <= {xmax} AND bbox.ymin >= {ymin} AND bbox.ymax <= {ymax})
      TO '{out}' (FORMAT json)""")


def load(db_path: str, ndjson: str, release: str, bbox) -> int:
    con = sqlite3.connect(db_path, timeout=60)
    con.execute("PRAGMA busy_timeout = 60000")
    con.executescript(DDL)
    n = skipped = 0
    with con:  # une transaction : tout ou rien
        con.execute("DELETE FROM overture_places")
        with open(ndjson, encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                addr = (r.get("addresses") or [{}])[0] or {}
                if addr.get("country") not in (None, "", "MX") or not r.get("name"):
                    skipped += 1
                    continue
                tax = r.get("taxonomy") or {}  # fichiers bruts (colonne taxonomy) acceptés aussi
                category = r.get("category") or tax.get("primary") or ""
                cats = [c for c in (r.get("alts") or (tax.get("hierarchy") or []) + (tax.get("alternates") or [])) if c]
                con.execute("INSERT OR REPLACE INTO overture_places VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    r["id"], (r.get("name") or "")[:300], category, r.get("basic_category") or "", ",".join(dict.fromkeys(cats))[:1000],
                    json.dumps(r.get("phones") or []), json.dumps(r.get("websites") or []), json.dumps(r.get("socials") or []), json.dumps(r.get("emails") or []),
                    (addr.get("freeform") or "")[:300], (addr.get("locality") or "")[:120], (addr.get("postcode") or "")[:20],
                    r.get("confidence"), r.get("operating_status") or "", r.get("lat"), r.get("lng"), release))
                n += 1
        meta = {"release": release, "loaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "count": str(n), "skipped": str(skipped), "bbox": ",".join(map(str, bbox))}
        for k, v in meta.items():
            con.execute("INSERT INTO overture_meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", (k, v))
    con.close()
    return n


def summary(db_path: str):
    """Contrôle du chargement : volumes, coordonnées dans la zone, catégories et contacts."""
    con = sqlite3.connect(db_path)
    n = con.execute("SELECT COUNT(*) FROM overture_places").fetchone()[0] or 1
    checks = [
        ("coordonnées dans la zone", "lat BETWEEN 17.8 AND 21.7 AND lng BETWEEN -89.5 AND -86.65"),
        ("catégorie", "category != ''"), ("téléphone", "phones != '[]'"), ("site", "websites != '[]'"),
        ("email", "emails != '[]'"), ("réseau", "socials != '[]'"),
    ]
    parts = []
    for label, where in checks:
        k = con.execute("SELECT COUNT(*) FROM overture_places WHERE " + where).fetchone()[0]
        parts.append("%s %d %%" % (label, round(100 * k / n)))
    print("  contrôle : " + " · ".join(parts))
    top = con.execute("SELECT category, COUNT(*) c FROM overture_places WHERE category != '' GROUP BY 1 ORDER BY 2 DESC LIMIT 6").fetchall()
    print("  catégories les plus fréquentes : " + ", ".join("%s (%d)" % (c, k) for c, k in top))
    con.close()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=os.environ.get("DATABASE_PATH", "data/crm.db"))
    p.add_argument("--release", default="")
    p.add_argument("--bbox", default="", help="xmin,ymin,xmax,ymax (doit rester dans le Quintana Roo) ; défaut : tout l'État")
    p.add_argument("--from-ndjson", default="", help="charge un extrait déjà téléchargé (tests)")
    p.add_argument("--keep", action="store_true", help="garde le fichier NDJSON temporaire")
    p.add_argument("--duckdb-cli", default="", help="binaire CLI DuckDB à utiliser à la place du module Python")
    a = p.parse_args()
    bbox = tuple(float(x) for x in a.bbox.split(",")) if a.bbox else QROO
    if not (QROO[0] <= bbox[0] < bbox[2] <= QROO[2] and QROO[1] <= bbox[1] < bbox[3] <= QROO[3]):
        sys.exit("Zone refusée : elle doit rester dans le cadre du Quintana Roo (jamais le monde entier).")
    os.makedirs("data/overture", exist_ok=True)
    t0 = time.time()
    if a.from_ndjson:
        release, out = a.release or "extrait-local", a.from_ndjson
    else:
        release = a.release or latest_release()
        out = os.path.join("data/overture", f"places-{release}.ndjson")
        print(f"Overture {release} : extraction de la zone {bbox}…", flush=True)
        extract(release, bbox, out, os.path.abspath("data/overture/duckdb_extensions"), a.duckdb_cli)
        print(f"  {os.path.getsize(out) / 1e6:.1f} Mo téléchargés en {time.time() - t0:.0f} s", flush=True)
    n = load(a.db, out, release, bbox)
    if not a.from_ndjson and not a.keep:
        os.remove(out)
    print(f"Overture {release} : {n} lieux chargés dans overture_places ({time.time() - t0:.0f} s)")
    summary(a.db)


if __name__ == "__main__":
    main()
