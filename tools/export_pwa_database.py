#!/usr/bin/env python3
"""Esporta DB MOVIMENTI da Contabilità.xlsb nel backup privato della PWA."""
import argparse
import datetime as dt
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".vendor"))
from pyxlsb import open_workbook  # noqa: E402


def excel_date(value):
    if value in (None, ""):
        return ""
    if isinstance(value, (int, float)):
        return (dt.datetime(1899, 12, 30) + dt.timedelta(days=value)).date().isoformat()
    text = str(value).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return dt.datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return text[:10]


def number(value):
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def fingerprint(row):
    raw = "|".join(
        [
            row["accounting_date"],
            row["value_date"],
            row["description"],
            str(round(row["amount"] * 100)),
            str(round(row["balance"] * 100)),
        ]
    ).lower()
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def categories_from_sqlite(db_path):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT c.year, c.name, c.movement,
               COALESCE(p.name, '') AS gruppo,
               COALESCE(GROUP_CONCAT(DISTINCT r.value), '') AS keywords
        FROM categories c
        LEFT JOIN categories p ON p.id=c.parent_id
        LEFT JOIN classification_rules r ON r.category_id=c.id AND r.active=1
        WHERE c.level=3 AND c.year IN (2024, 2025, 2026)
        GROUP BY c.id ORDER BY c.year, c.movement, gruppo, c.name
        """
    ).fetchall()
    con.close()
    return [
        {
            "id": i,
            "year": int(r["year"]),
            "name": r["name"],
            "movement": r["movement"] or "",
            "group": r["gruppo"],
            "keywords": "; ".join(dict.fromkeys(k.strip() for k in r["keywords"].split(",") if k.strip())),
        }
        for i, r in enumerate(rows, 1)
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sqlite", type=Path, default=ROOT / "data/contabilita.db")
    args = parser.parse_args()

    movements, seen = [], set()
    with open_workbook(str(args.source)) as workbook:
        with workbook.get_sheet("DB MOVIMENTI") as sheet:
            rows = sheet.rows()
            headers = [str(c.v or "").strip() for c in next(rows)]
            for cells in rows:
                values = [c.v for c in cells]
                source = dict(zip(headers, values))
                year = int(number(source.get("ANNO")))
                if year not in (2024, 2025, 2026):
                    continue
                amount = number(source.get("Importo €"))
                movement = str(source.get("MOVIMENTO") or ("ENTRATE" if amount >= 0 else "USCITE")).strip().upper()
                description = str(source.get("Descrizione") or "").strip()
                row = {
                    "id": len(movements) + 1,
                    "bank": str(source.get("BANCA") or "").strip(),
                    "accounting_date": excel_date(source.get("Data contabile")),
                    "value_date": excel_date(source.get("Data valuta")),
                    "causale": str(source.get("Causale") or "").strip(),
                    "description": description,
                    "extended_description": description,
                    "combined": str(source.get("Causale+Descrizione") or "").strip(),
                    "amount": amount,
                    "credit": amount if amount > 0 else 0,
                    "debit": abs(amount) if amount < 0 else 0,
                    "currency": "EUR",
                    "category": str(source.get("VOCE") or "Da classificare").strip() or "Da classificare",
                    "balance": number(source.get("SALDO")),
                    "month": int(number(source.get("MESE"))) or None,
                    "year": year,
                    "movement": movement,
                    "various_expense_check": str(source.get("CHECK SPESE VARIE") or "").strip(),
                    "note": str(source.get("NOTE CHECK") or "").strip(),
                    "excluded": False,
                    "classification_mode": "origine_excel",
                }
                row["fingerprint"] = fingerprint(row)
                if row["fingerprint"] in seen:
                    continue
                seen.add(row["fingerprint"])
                movements.append(row)

    payload = {
        "format": "casa-finance-backup",
        "version": 1,
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": {"file": args.source.name, "sheet": "DB MOVIMENTI", "years": [2024, 2025, 2026]},
        "data": {
            "movements": movements,
            "categories": categories_from_sqlite(args.sqlite),
            "plans": [],
            "loans": [],
            "meta": [{"id": 1, "key": "initial_import", "movements": len(movements)}],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {year: sum(1 for r in movements if r["year"] == year) for year in (2024, 2025, 2026)}
    print(json.dumps({"output": str(args.output), "rows": len(movements), "years": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
