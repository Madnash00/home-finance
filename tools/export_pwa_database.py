#!/usr/bin/env python3
"""Crea il database iniziale completo della PWA dal file Contabilità XLSB."""
import argparse
import datetime as dt
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".vendor"))
from pyxlsb import open_workbook  # noqa: E402


def excel_date(value):
    if value in (None, ""):
        return ""
    if isinstance(value, (int, float)):
        return (dt.datetime(1899, 12, 30) + dt.timedelta(days=float(value))).date().isoformat()
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


def integer(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def text(value):
    return str(value or "").strip()


def base_fingerprint(row):
    raw = "|".join(
        [row["accounting_date"], row["value_date"], row["description"],
         str(round(row["amount"] * 100)), str(round(row["balance"] * 100))]
    ).lower()
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def read_sheet(workbook, name):
    with workbook.get_sheet(name) as sheet:
        rows = sheet.rows()
        headers = [text(c.v) for c in next(rows)]
        return [dict(zip(headers, [c.v for c in row])) for row in rows]


def read_matrix(workbook, name):
    with workbook.get_sheet(name) as sheet:
        return [[c.v for c in row] for row in sheet.rows()]


def rules_and_categories(rows):
    categories, rules, seen_rules, seen_fallbacks = [], [], set(), set()
    for order, row in enumerate(rows, 1):
        year = integer(row.get("ANNO"))
        movement, group, name = text(row.get("MOVIMENTO")).upper(), text(row.get("CAUSALE")), text(row.get("DETTAGLIO"))
        if not (2016 <= year <= 2026 and movement in {"ENTRATE", "USCITE"} and group and name):
            continue
        keyword = str(row.get("KEYWORD LIST") or "")
        if keyword.strip() == "-":
            keyword = ""
        description = text(row.get("DESCRIZIONE"))
        if keyword:
            rule_key = (year, movement, keyword.casefold().strip())
            if rule_key in seen_rules:
                continue
            seen_rules.add(rule_key)
            rules.append({"year": year, "movement": movement, "category": name, "group": group,
                          "keyword": keyword, "description": description, "order": order})
        else:
            fallback_key = (year, movement, group, name)
            if fallback_key in seen_fallbacks:
                continue
            seen_fallbacks.add(fallback_key)
        categories.append({"id": len(categories) + 1, "year": year, "movement": movement,
                           "group": group, "name": name, "keywords": keyword,
                           "description": description, "source": "DB ANALISI_Consolidato"})
    base_2018 = [c.copy() for c in categories if c["year"] == 2018]
    for year in (2016, 2017):
        for base in base_2018:
            clone = {**base, "id": len(categories) + 1, "year": year, "source": "base_2018"}
            categories.append(clone)
    return categories, rules


def planning(rows, categories):
    plans, existing = [], {(c["year"], c["movement"], c["group"], c["name"]) for c in categories}
    for row in rows:
        movement, kind, group, name = text(row.get("MOVIMENTO")).upper(), text(row.get("TIPO MOVIMENTO")), text(row.get("GRUPPO")), text(row.get("CAUSALE"))
        if movement not in {"ENTRATE", "USCITE"} or not name:
            continue
        plans.append({"id": len(plans) + 1, "scope": "analysis", "year": integer(row.get("YEAR")) or 2026, "movement": movement,
                      "type": kind, "group": group, "category": name, "budget": number(row.get("BDGT YEAR")),
                      "forecast": number(row.get("FRCST YEAR")), "budget_month": number(row.get("BDGT MONTH")),
                      "forecast_month": number(row.get("FRCST MONTH")), "actual_source": number(row.get("€ YEAR")),
                      "ly_source": number(row.get("€ LY")), "lly_source": number(row.get("€ LLY")),
                      "source": "DB ANALISI_Forecast"})
        key = (2026, movement, group, name)
        if key not in existing:
            categories.append({"id": len(categories) + 1, "year": 2026, "movement": movement, "group": group,
                               "name": name, "keywords": "", "description": "", "type": kind,
                               "source": "DB ANALISI_Forecast"})
            existing.add(key)
    return plans


def management_planning(matrix, start_id, year=2026):
    result = []

    def add_rows(start, end, movement):
        sign = -1 if movement == "USCITE" else 1
        for row in matrix[start - 1:end]:
            values = list(row) + [None] * max(0, 25 - len(row))
            description, group, analysis_category = text(values[20]), text(values[21]), text(values[22])
            if not description or description.casefold() in {"descrizione", "totale", "pagamenti contanti  o pos"}:
                continue
            result.append({"id": start_id + len(result), "scope": "management", "year": year,
                           "movement": movement, "group": group, "category": description,
                           "analysis_category": analysis_category, "budget": sign * abs(number(values[23])),
                           "forecast": sign * abs(number(values[24])), "actual_source": None,
                           "ly_source": None, "lly_source": None, "source": "DB ANALISI_Forecast dettaglio"})

    add_rows(3, 12, "ENTRATE")
    add_rows(17, 44, "USCITE")
    return result


def reconcile_plans(plans, transactions):
    totals = defaultdict(float)
    for transaction in transactions:
        if transaction.get("is_opening_balance"):
            continue
        key = (transaction["year"], transaction["movement"], transaction["group"], transaction["category"])
        totals[key] += transaction["amount"]
    for plan in plans:
        if plan.get("scope") != "analysis":
            continue
        base = (plan["movement"], plan["group"], plan["category"])
        for source_key, adjustment_key, year in (
            ("actual_source", "actual_adjustment", plan["year"]),
            ("ly_source", "ly_adjustment", plan["year"] - 1),
            ("lly_source", "lly_adjustment", plan["year"] - 2),
        ):
            calculated = round(totals[(year, *base)], 2)
            plan[adjustment_key] = round(plan[source_key] - calculated, 2)


def keyword_matches(haystack, keyword):
    raw = keyword.casefold()
    needle = raw.strip()
    if not needle:
        return False
    if raw != needle:
        return raw in f" {haystack} "
    return needle in haystack


def classify(combined, explicit, year, movement, rules):
    candidates = [r for r in rules if r["year"] == year and r["movement"] == movement]
    if not candidates:
        candidates = [r for r in rules if r["year"] == 2018 and r["movement"] == movement]
    explicit_norm = explicit.casefold().strip("* ")
    if explicit_norm:
        exact = [r for r in candidates if r["keyword"].casefold().strip("* ") == explicit_norm]
        if exact:
            return exact[0]["category"], exact[0]["group"], "voce_excel"
    haystack = combined.casefold()
    matches = [r for r in candidates if keyword_matches(haystack, r["keyword"])]
    if matches:
        best = max(matches, key=lambda r: (len(r["keyword"].strip()), -r["order"]))
        return best["category"], best["group"], "keyword"
    if movement == "ENTRATE":
        return "ENTRATE VARIE", "ENTRATE EXTRA", "varie"
    return "USCITE VARIE", "USCITE EXTRA", "varie"


def movements(rows, rules, opening_balance):
    result, fingerprints, running = [], Counter(), opening_balance
    source_balance_differences = []
    for source_row, row in enumerate(rows, 2):
        accounting_date, value_date = excel_date(row.get("Data contabile")), excel_date(row.get("Data valuta"))
        amount = number(row.get("Importo €"))
        is_opening = source_row == 2
        if is_opening:
            amount, running = opening_balance, opening_balance
        else:
            running = round(running + amount, 2)
        date_for_period = value_date or accounting_date
        derived_year, derived_month = integer(date_for_period[:4]), integer(date_for_period[5:7])
        source_year, source_month = integer(row.get("ANNO")), integer(row.get("MESE"))
        year = source_year if 2016 <= source_year <= 2026 else derived_year
        month = source_month if 1 <= source_month <= 12 else derived_month
        movement = text(row.get("MOVIMENTO")).upper()
        if movement not in {"ENTRATE", "USCITE"}:
            movement = "ENTRATE" if amount >= 0 else "USCITE"
        causale, description = text(row.get("Causale")), text(row.get("Descrizione"))
        combined = text(row.get("Causale+Descrizione")) or f"{causale} {description}".strip()
        explicit = text(row.get("VOCE"))
        category, group, mode = classify(combined, explicit, year, movement, rules)
        source_balance = number(row.get("SALDO"))
        if abs(source_balance - running) > 0.011:
            source_balance_differences.append({"row": source_row, "source": source_balance, "calculated": running})
        item = {"id": len(result) + 1, "source_row": source_row, "bank": text(row.get("BANCA")),
                "accounting_date": accounting_date, "value_date": value_date, "causale": causale,
                "description": description, "extended_description": description, "combined": combined,
                "amount": amount, "credit": amount if amount > 0 else 0, "debit": abs(amount) if amount < 0 else 0,
                "currency": "EUR", "source_category": explicit, "category": category, "group": group,
                "balance": running, "source_balance": source_balance, "month": month, "year": year,
                "movement": movement, "various_expense_check": text(row.get("CHECK SPESE VARIE")),
                "note": text(row.get("NOTE CHECK")), "excluded": False, "is_opening_balance": is_opening,
                "classification_mode": mode}
        base = base_fingerprint(item)
        fingerprints[base] += 1
        item["fingerprint"] = f"{base}:{fingerprints[base]}"
        result.append(item)
    return result, source_balance_differences


def loans(rows):
    result = []
    for row in rows:
        description = text(row.get("DESCRIZIONE"))
        if not description or description.casefold() == "totale":
            continue
        note = text(row.get("Note"))
        result.append({"id": len(result) + 1, "description": description, "lender": note,
                       "start": excel_date(row.get("DATA ATTIVAZIONE")), "end": excel_date(row.get("SCADENZA")),
                       "installments_source": integer(row.get("NUMERO RATE")), "payment": number(row.get("IMPORTO RATA")),
                       "status": text(row.get("STATO")).upper(), "notes": note, "source": "FINANZIAMENTI"})
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with open_workbook(str(args.source)) as workbook:
        movement_rows = read_sheet(workbook, "DB MOVIMENTI")
        consolidated_rows = read_sheet(workbook, "DB ANALISI_Consolidato")
        forecast_rows = read_sheet(workbook, "DB ANALISI_Forecast")
        forecast_matrix = read_matrix(workbook, "DB ANALISI_Forecast")
        loan_rows = read_sheet(workbook, "FINANZIAMENTI")
        current_balances = read_sheet(workbook, "SALDO")
        monthly_balances = read_sheet(workbook, "CONTO CORRENTE")
    categories, rules = rules_and_categories(consolidated_rows)
    analysis_plans = planning(forecast_rows, categories)
    management_plans = management_planning(forecast_matrix, len(analysis_plans) + 1)
    opening_balance = 73329.89
    txs, balance_differences = movements(movement_rows, rules, opening_balance)
    reconcile_plans(analysis_plans, txs)
    plans = analysis_plans + management_plans
    account_balances = defaultdict(float)
    for transaction in txs:
        account_balances[transaction["bank"]] += transaction["amount"]
    payload = {"format": "casa-finance-backup", "version": 3, "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
               "source": {"file": args.source.name, "sheets": ["DB MOVIMENTI", "DB ANALISI_Consolidato",
                           "DB ANALISI_Forecast", "FINANZIAMENTI", "SALDO", "CONTO CORRENTE"]},
               "data": {"movements": txs, "categories": categories, "plans": plans, "loans": loans(loan_rows),
                        "meta": [{"id": 1, "key": "initial_import", "opening_balance": opening_balance,
                                  "movement_rows": len(txs), "closing_balance": txs[-1]["balance"],
                                  "account_balances": {k: round(v, 2) for k, v in account_balances.items()},
                                  "source_balance_difference_count": len(balance_differences),
                                  "balance_note": "Il saldo progressivo app è complessivo; SALDO Excel è progressivo per conto."},
                                 {"id": 2, "key": "source_balances", "current": current_balances,
                                  "monthly": monthly_balances},
                                 {"id": 3, "key": "classification-rules-v2",
                                  "completedAt": dt.datetime.now(dt.timezone.utc).isoformat()}]}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    stats = {"output": str(args.output), "movements": len(txs), "years": dict(sorted(Counter(t["year"] for t in txs).items())),
             "categories": len(categories), "plans": len(plans), "analysis_plans": len(analysis_plans),
             "management_plans": len(management_plans), "loans": len(payload["data"]["loans"]),
             "opening_balance": opening_balance, "closing_balance": txs[-1]["balance"],
             "source_balance_differences": len(balance_differences)}
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
