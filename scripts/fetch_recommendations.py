#!/usr/bin/env python3
"""
Oppdaterer data/recommendations.json hver time:
1. Sikrer at alle portefølje-, kandidat- og «Følg med på»-aksjer ligger i stocks-listen.
2. Henter siste aksjekurser og dagens kursendring fra Yahoo Finance (OSE, SSE, CSE, HEX) + valutakurser (SEK, DKK, EUR -> NOK).
3. Beregner historisk sesongmønster (månedlig gjennomsnittsavkastning, andel positive år, beste/svakeste måneder og 3-månedersperioder siste opptil 10 år) fra Yahoo Finance.
4. Beregner aktuell porteføljeverdi i NOK (både mobilverdi uten suspendert Cadeler A/S og totalverdi inkl. Cadeler-oppgjør), dagens endring, urealisert resultat, porteføljevekter og oppside til kursmål.
5. Henter siste børsmeldinger fra Oslo Børs NewsWeb API.
6. Henter siste finansnyheter om kursmål og anbefalinger fra RSS (Google News NO/SE og E24).
"""

import datetime
import json
import os
import re
import statistics
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(BASE_DIR, "data", "recommendations.json")

OSLO_TZ = datetime.timezone(datetime.timedelta(hours=1))

MONTH_NAMES_NO = [
    "", "Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"
]

FX_SYMBOLS = {
    "NOK": None,
    "SEK": "SEKNOK=X",
    "DKK": "DKKNOK=X",
    "EUR": "EURNOK=X",
}

DEFAULT_FX = {
    "NOK": 1.0,
    "SEK": 0.9568,
    "DKK": 1.4370,
    "EUR": 10.7414,
}

DEFAULT_WATCHLIST = [
    "DNB.OL",
    "NOVO-B.CO",
    "SYNSAM.ST",
    "INVE-B.ST",
    "SALM.OL",
    "MOWI.OL",
    "AKRBP.OL",
    "SUBC.OL",
    "SCATC.OL",
    "KIT.OL",
    "VEND.OL",
    "MING.OL",
    "KOG.OL",
    "NOD.OL",
]

ADDITIONAL_CANDIDATES = [
    {
        "ticker": "MOWI.OL",
        "name": "Mowi ASA",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Sjømat",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 225.60,
        "rule_status": "Kandidat",
        "portfolio_action": "KANDIDAT",
        "portfolio_rationale": "Kjøp hos SEB (250 NOK) og inne i DNB Carnegies ukesportefølje.",
        "recommendations": [
            {"broker": "SEB", "rating": "KJØP", "target": 250.0, "upside_pct": 10.8, "date": "2026-11-18", "source": "Finansavisen (kjøpsanbefaling sammen med SalMar)"},
            {"broker": "Pareto Securities", "rating": "HOLD", "target": 230.0, "upside_pct": 2.0, "date": "2026-11-04", "source": "Pareto Research History"},
        ],
    },
    {
        "ticker": "KIT.OL",
        "name": "Kitron ASA",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Teknologi",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 85.90,
        "rule_status": "Kandidat",
        "portfolio_action": "KANDIDAT",
        "portfolio_rationale": "Tatt inn i DNB Carnegies ukesportefølje 09.11.2026 etter kursfall på Q3-tallene.",
        "recommendations": [
            {"broker": "DNB Carnegie", "rating": "HOLD", "target": 103.0, "upside_pct": 19.9, "date": "2026-11-09", "source": "Finansavisen / TDN Direkt (i DNB Carnegies ukesportefølje)"},
            {"broker": "Pareto Securities", "rating": "HOLD", "target": 90.44, "upside_pct": 5.3, "date": "2026-10-23", "source": "Pareto Research History"},
        ],
    },
    {
        "ticker": "DOFG.OL",
        "name": "DOF Group ASA",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Energi og Offshore",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 122.10,
        "rule_status": "Kandidat",
        "portfolio_action": "KANDIDAT",
        "portfolio_rationale": "Petrobras-forlengelser for tre PLSV-fartøy til 2032; Kjøp hos DNB Carnegie og Fearnley.",
        "recommendations": [
            {"broker": "DNB Carnegie", "rating": "KJØP", "target": 150.0, "upside_pct": 22.9, "date": "2026-11-09", "source": "DNB Nyheter"},
            {"broker": "Fearnley Securities", "rating": "KJØP", "target": 148.0, "upside_pct": 21.2, "date": "2026-08-10", "source": "Finansavisen"},
        ],
    },
    {
        "ticker": "KMAR.OL",
        "name": "Kongsberg Maritime ASA",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Industri og Forsvar",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 58.84,
        "rule_status": "Kandidat",
        "portfolio_action": "KANDIDAT",
        "portfolio_rationale": "Inne i Paretos månedsportefølje for november 2026.",
        "recommendations": [
            {"broker": "Pareto Securities", "rating": "KJØP", "target": 80.0, "upside_pct": 36.0, "date": "2026-11-02", "source": "Pareto Research History (i november-porteføljen)"},
        ],
    },
    {
        "ticker": "ODL.OL",
        "name": "Odfjell Drilling Ltd",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Energi og Offshore",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 109.40,
        "rule_status": "Kandidat",
        "portfolio_action": "KANDIDAT",
        "portfolio_rationale": "Inne i Paretos månedsportefølje for november 2026.",
        "recommendations": [
            {"broker": "Pareto Securities", "rating": "KJØP", "target": 120.0, "upside_pct": 9.7, "date": "2026-11-03", "source": "Pareto Research History (i november-porteføljen)"},
        ],
    },
    {
        "ticker": "LINK.OL",
        "name": "LINK Mobility Group Holding ASA",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Teknologi",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 25.10,
        "rule_status": "Kandidat",
        "portfolio_action": "KANDIDAT",
        "portfolio_rationale": "Inne i Paretos november-portefølje (~11–13 % FCF-yield 2027–2028e).",
        "recommendations": [
            {"broker": "Pareto Securities", "rating": "KJØP", "target": 35.0, "upside_pct": 39.4, "date": "2026-11-04", "source": "Pareto Research History (i november-porteføljen)"},
        ],
    },
    {
        "ticker": "YAR.OL",
        "name": "Yara International ASA",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Industri",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 402.00,
        "rule_status": "Overvåkes",
        "portfolio_action": "OVERBLIKK",
        "portfolio_rationale": "Uenighet blant meglerhusene: Kjøp hos Pareto (500 NOK), Hold hos SEB (420 NOK) og Selg hos DNB Carnegie (350 NOK).",
        "recommendations": [
            {"broker": "Pareto Securities", "rating": "KJØP", "target": 500.0, "upside_pct": 24.4, "date": "2026-10-23", "source": "Finansavisen / TDN Direkt"},
            {"broker": "SEB", "rating": "HOLD", "target": 420.0, "upside_pct": 4.5, "date": "2026-10-08", "source": "Finansavisen / TDN Direkt"},
            {"broker": "DNB Carnegie", "rating": "SELG", "target": 350.0, "upside_pct": -12.9, "date": "2026-10-23", "source": "Finansavisen / TDN Direkt"},
        ],
    },
    {
        "ticker": "ORK.OL",
        "name": "Orkla ASA",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Konsum",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 101.90,
        "rule_status": "Overvåkes",
        "portfolio_action": "OVERBLIKK",
        "portfolio_rationale": "Hold hos både Pareto (107 NOK) og DNB Carnegie (95 NOK).",
        "recommendations": [
            {"broker": "Pareto Securities", "rating": "HOLD", "target": 107.0, "upside_pct": 5.0, "date": "2026-11-06", "source": "Pareto Research History"},
            {"broker": "DNB Carnegie", "rating": "HOLD", "target": 95.0, "upside_pct": -6.8, "date": "2026-11-06", "source": "DNB Nyheter"},
        ],
    },
    {
        "ticker": "VAR.OL",
        "name": "Vår Energi ASA",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Energi og Offshore",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 49.50,
        "rule_status": "Overvåkes",
        "portfolio_action": "UNNGÅ",
        "portfolio_rationale": "Kjøp hos Nordea (62 NOK), men Selg hos ABG (45 NOK) og SEB (41 NOK).",
        "recommendations": [
            {"broker": "Nordea", "rating": "KJØP", "target": 62.0, "upside_pct": 25.3, "date": "2026-10-19", "source": "Placera / Finwire"},
            {"broker": "ABG Sundal Collier", "rating": "SELG", "target": 45.0, "upside_pct": -9.1, "date": "2026-11-20", "source": "Finansavisen"},
            {"broker": "SEB", "rating": "SELG", "target": 41.0, "upside_pct": -17.2, "date": "2026-11-10", "source": "Börskollen / Finwire"},
        ],
    },
    {
        "ticker": "GJF.OL",
        "name": "Gjensidige Forsikring ASA",
        "exchange": "OSE",
        "currency": "NOK",
        "sector": "Finans",
        "in_portfolio": False,
        "shares": 0,
        "gav": 0,
        "price": 260.00,
        "rule_status": "Overvåkes",
        "portfolio_action": "OVERBLIKK",
        "portfolio_rationale": "Hold hos Pareto (280 NOK).",
        "recommendations": [
            {"broker": "Pareto Securities", "rating": "HOLD", "target": 280.0, "upside_pct": 7.7, "date": "2026-10-26", "source": "Pareto Research History"},
        ],
    },
]

EXTRA_OSLO_ISSUERS = [
    "MOWI", "DOFG", "KIT", "KMAR", "ODL", "LINK", "ORK", "YAR", "VAR", "GJF", "ELK", "B2I", "ENDUR"
]

RSS_FEEDS = [
    {
        "name": "Google News – Kursmål & Meglerhus (NO)",
        "url": "https://news.google.com/rss/search?q="
        + urllib.parse.quote(
            '("kursmål" OR "anbefaling" OR "oppgraderer" OR "nedgraderer") '
            '("Pareto" OR "DNB Carnegie" OR "ABG" OR "Arctic" OR "SB1 Markets" OR "SEB" OR "Fearnley" OR "Nordea" OR "Danske Bank")'
        )
        + "&hl=no&gl=NO&ceid=NO:no",
    },
    {
        "name": "Google News – Riktkurs & Analys (SE)",
        "url": "https://news.google.com/rss/search?q="
        + urllib.parse.quote(
            '("riktkurs" OR "köp" OR "behåll") ("DNB Carnegie" OR "SEB" OR "Nordea" OR "Pareto" OR "ABG") '
            '("Synsam" OR "Invisio" OR "Novo Nordisk" OR "Investor")'
        )
        + "&hl=sv&gl=SE&ceid=SE:sv",
    },
    {
        "name": "E24 Børs og Finans RSS",
        "url": "https://e24.no/rss2/?seksjon=boers-og-finans",
    },
]

BROKER_PATTERNS = {
    "Pareto Securities": r"\bpareto\b",
    "DNB Carnegie": r"\b(?:dnb\s*carnegie|dnb\s*markets|carnegie)\b",
    "ABG Sundal Collier": r"\babg\b",
    "Arctic Securities": r"\barctic\b",
    "SB1 Markets": r"\b(?:sb1|sparebank\s*1\s*markets)\b",
    "SEB": r"\bseb\b",
    "Fearnley Securities": r"\bfearnley\b",
    "Clarksons Securities": r"\bclarksons\b",
    "Nordea": r"\bnordea\b",
    "Danske Bank": r"\bdanske\s*bank\b",
}

RATING_PATTERNS = [
    ("KJØP", r"\b(?:kjøp|kjøpsanbefaling|oppgraderer\s+til\s+kjøp|köp|buy)\b"),
    ("SELG", r"\b(?:selg|salgsanbefaling|nedgraderer\s+til\s+selg|sälj|sell)\b"),
    ("HOLD", r"\b(?:hold|nøytral|behåll|avvakt|nedgraderer\s+til\s+hold)\b"),
]

TARGET_REGEX = re.compile(
    r"(?:kursmål(?:et)?|riktkurs(?:en)?|til)\s*(?:på|til)?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:kroner|kr|nok|sek|dkk|eur)?",
    re.IGNORECASE,
)

BORSMELDING_NOISE_PATTERNS = re.compile(
    r"(?:renteregulering|fixation of interest rate|offentliggjøring av rente|new interest rate|"
    r"mottatt søknad om notering av obligasjonslån|received application for listing of bonds|"
    r"result of issuing auction ngb|treasury bills|statskasseveksler)",
    re.IGNORECASE,
)


def ensure_candidates_and_watchlist(data: dict):
    stocks = data.setdefault("stocks", [])
    existing_tickers = {s.get("ticker", "").upper() for s in stocks}
    for cand in ADDITIONAL_CANDIDATES:
        if cand["ticker"].upper() not in existing_tickers:
            stocks.append(dict(cand))
            existing_tickers.add(cand["ticker"].upper())

    if "watchlist" not in data or not isinstance(data["watchlist"], list) or len(data["watchlist"]) == 0:
        data["watchlist"] = list(DEFAULT_WATCHLIST)

    for wt in data["watchlist"]:
        wt_up = (wt or "").strip().upper()
        if wt_up and wt_up not in existing_tickers:
            stocks.append({
                "ticker": wt_up,
                "name": wt_up,
                "exchange": "OSE" if wt_up.endswith(".OL") else "NORDIC",
                "currency": "NOK" if wt_up.endswith(".OL") else "SEK",
                "sector": "Overvåkes",
                "in_portfolio": False,
                "shares": 0,
                "gav": 0,
                "price": 0.0,
                "value_nok": 0.0,
                "weight_pct": 0.0,
                "rule_status": "Følg med på",
                "portfolio_action": "FØLG MED PÅ",
                "portfolio_rationale": "Lagt til i «Følg med på»-listen.",
                "recommendations": [],
            })
            existing_tickers.add(wt_up)


def fetch_yahoo_quote(symbol: str, timeout: int = 8):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?interval=1d&range=5d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read())
    results = payload.get("chart", {}).get("result") or []
    if not results:
        return None
    meta = results[0].get("meta", {})
    price = meta.get("regularMarketPrice")
    closes = [
        c
        for c in (results[0].get("indicators", {}).get("quote", [{}])[0].get("close") or [])
        if c is not None
    ]
    prev_close = closes[-2] if len(closes) >= 2 else (meta.get("chartPreviousClose") or meta.get("previousClose"))
    if price is None:
        return None
    day_change_pct = 0.0
    if prev_close and prev_close > 0:
        day_change_pct = round(((price / prev_close) - 1.0) * 100.0, 2)
    return {
        "price": round(float(price), 4 if price < 5 else 2),
        "prev_close": round(float(prev_close), 4 if prev_close and prev_close < 5 else 2) if prev_close else None,
        "day_change_pct": day_change_pct,
        "short_name": meta.get("longName") or meta.get("shortName"),
        "currency": meta.get("currency"),
    }


def fetch_yahoo_seasonality(symbol: str, timeout: int = 8):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?interval=1mo&range=10y"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read())
    results = payload.get("chart", {}).get("result") or []
    if not results:
        return None
    res = results[0]
    timestamps = res.get("timestamp") or []
    closes = (res.get("indicators", {}).get("quote", [{}])[0].get("close")) or []
    if len(timestamps) < 4 or len(closes) < 4:
        return None

    points = []
    for ts, cl in zip(timestamps, closes):
        if cl is not None and cl > 0:
            dt = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
            points.append((dt.year, dt.month, float(cl)))

    if len(points) < 4:
        return None

    by_month = {m: [] for m in range(1, 13)}
    years_seen = set()
    for i in range(1, len(points)):
        y_prev, m_prev, c_prev = points[i - 1]
        y_cur, m_cur, c_cur = points[i]
        # Kun påfølgende måneder
        diff_months = (y_cur - y_prev) * 12 + (m_cur - m_prev)
        if diff_months != 1 or c_prev <= 0:
            continue
        ret_pct = ((c_cur / c_prev) - 1.0) * 100.0
        # Filtrer ut ekstreme databrudd/spleis-feil
        if -75.0 <= ret_pct <= 150.0:
            by_month[m_cur].append(ret_pct)
            years_seen.add(y_cur)

    months_stats = []
    for m in range(1, 13):
        vals = by_month[m]
        if vals:
            avg_val = round(sum(vals) / len(vals), 2)
            med_val = round(statistics.median(vals), 2)
            win_rate = round((sum(1 for v in vals if v > 0) / len(vals)) * 100.0, 0)
            months_stats.append({
                "month": m,
                "name": MONTH_NAMES_NO[m],
                "avg_pct": avg_val,
                "median_pct": med_val,
                "win_rate_pct": int(win_rate),
                "count": len(vals),
            })
        else:
            months_stats.append({
                "month": m,
                "name": MONTH_NAMES_NO[m],
                "avg_pct": 0.0,
                "median_pct": 0.0,
                "win_rate_pct": 0,
                "count": 0,
            })

    valid_months = [ms for ms in months_stats if ms["count"] >= 2]
    if not valid_months:
        valid_months = [ms for ms in months_stats if ms["count"] >= 1]
    if not valid_months:
        return None

    sorted_by_avg = sorted(valid_months, key=lambda x: x["avg_pct"], reverse=True)
    best_months = sorted_by_avg[:2]
    weakest_months = list(reversed(sorted_by_avg[-2:]))

    # Beregn beste og svakeste rullerende 3-månedersperiode
    month_map = {ms["month"]: ms["avg_pct"] for ms in months_stats}
    windows_3m = []
    for start_m in range(1, 13):
        m1 = start_m
        m2 = ((start_m) % 12) + 1
        m3 = ((start_m + 1) % 12) + 1
        sum_3m = round(month_map.get(m1, 0.0) + month_map.get(m2, 0.0) + month_map.get(m3, 0.0), 1)
        label = f"{MONTH_NAMES_NO[m1]}–{MONTH_NAMES_NO[m3]}"
        windows_3m.append((label, sum_3m))

    windows_3m.sort(key=lambda x: x[1], reverse=True)
    best_3m = windows_3m[0]
    weak_3m = windows_3m[-1]

    n_years = len(years_seen)
    b1, b2 = best_months[0], best_months[1] if len(best_months) > 1 else best_months[0]
    w1, w2 = weakest_months[0], weakest_months[1] if len(weakest_months) > 1 else weakest_months[0]

    summary_no = (
        f"Basert på {n_years} år med kursdata har {b1['name']} ({b1['avg_pct']:+.1f} %, positiv i {b1['win_rate_pct']} % av årene) "
        f"og {b2['name']} ({b2['avg_pct']:+.1f} %) vært de historisk sterkeste månedene, "
        f"mens {w1['name']} ({w1['avg_pct']:+.1f} %) og {w2['name']} ({w2['avg_pct']:+.1f} %) har vært svakest. "
        f"Beste 3-månedersperiode historisk er {best_3m[0]} ({best_3m[1]:+.1f} % samlet snitt). "
        f"(Historisk sesongmønster er kun statistikk og ingen garanti for fremtidig kursutvikling.)"
    )

    return {
        "years_analyzed": n_years,
        "best_months": [
            {"name": bm["name"], "avg_pct": bm["avg_pct"], "win_rate_pct": bm["win_rate_pct"], "count": bm["count"]}
            for bm in best_months
        ],
        "weakest_months": [
            {"name": wm["name"], "avg_pct": wm["avg_pct"], "win_rate_pct": wm["win_rate_pct"], "count": wm["count"]}
            for wm in weakest_months
        ],
        "best_3m_window": f"{best_3m[0]} ({best_3m[1]:+.1f} %)",
        "weakest_3m_window": f"{weak_3m[0]} ({weak_3m[1]:+.1f} %)",
        "months": months_stats,
        "summary_no": summary_no,
    }


def update_prices_and_portfolio(data: dict, now_oslo: datetime.datetime):
    fx_rates = dict(DEFAULT_FX)
    for cur, sym in FX_SYMBOLS.items():
        if not sym:
            continue
        try:
            q = fetch_yahoo_quote(sym)
            if q and q.get("price"):
                fx_rates[cur] = round(float(q["price"]), 4)
        except Exception as e:
            print(f"[WARN] Kunne ikke hente valutakurs {sym}: {e}")

    data.setdefault("metadata", {})["fx_rates"] = fx_rates

    stocks = data.get("stocks", [])
    updated_count = 0
    seasonality_count = 0

    for s in stocks:
        ticker = s.get("ticker", "")
        if not ticker or ticker == "PLCS":
            continue

        # Oppdater sesongmønster (10 års månedlige data)
        try:
            seas = fetch_yahoo_seasonality(ticker)
            if seas:
                s["seasonality"] = seas
                seasonality_count += 1
        except Exception as e:
            print(f"[WARN] Kunne ikke beregne sesongdata for {ticker}: {e}")

        # Cadeler A/S (440 aksjer) er under tvangsinnløsning (Squeeze-out) til fast kontantkurs 58,42 NOK (frist 07.12.2026)
        if ticker == "CDLR.OL" and s.get("squeeze_out_price"):
            s["price"] = float(s["squeeze_out_price"])
            s["prev_close"] = float(s["squeeze_out_price"])
            s["day_change_pct"] = 0.0
            s["price_updated_at"] = "Fast innløsningskurs (58,42 NOK)"
        else:
            try:
                q = fetch_yahoo_quote(ticker)
                if q and q.get("price"):
                    s["price"] = q["price"]
                    s["prev_close"] = q["prev_close"]
                    s["day_change_pct"] = q["day_change_pct"]
                    s["price_updated_at"] = now_oslo.strftime("%Y-%m-%d %H:%M CET")
                    if s.get("name") == ticker and q.get("short_name"):
                        s["name"] = q["short_name"]
                    updated_count += 1
            except Exception as e:
                print(f"[WARN] Kunne ikke hente kurs for {ticker}: {e}")

        price = float(s.get("price") or 0.0)
        for rec in s.get("recommendations", []):
            target = float(rec.get("target") or 0.0)
            if price > 0 and target > 0:
                rec["upside_pct"] = round(((target / price) - 1.0) * 100.0, 1)

    total_portfolio_nok = 0.0
    total_prev_nok = 0.0
    for s in stocks:
        shares = float(s.get("shares") or 0.0)
        price = float(s.get("price") or 0.0)
        prev_close = float(s.get("prev_close") or price)
        cur = s.get("currency", "NOK")
        fx = float(fx_rates.get(cur, 1.0))

        if s.get("in_portfolio") and shares > 0:
            val_nok = round(shares * price * fx, 2)
            prev_nok = round(shares * prev_close * fx, 2)
            s["value_nok"] = val_nok
            s["day_change_nok"] = round(val_nok - prev_nok, 2)
            gav = float(s.get("gav") or 0.0)
            cost_nok = round(shares * gav * fx, 2) if gav > 0 else val_nok
            s["cost_nok"] = cost_nok
            s["unrealized_nok"] = round(val_nok - cost_nok, 2)
            s["unrealized_pct"] = round(((val_nok / cost_nok) - 1.0) * 100.0, 2) if cost_nok > 0 else 0.0
            total_portfolio_nok += val_nok
            total_prev_nok += prev_nok
        else:
            s["value_nok"] = 0.0
            s["day_change_nok"] = 0.0
            s["weight_pct"] = 0.0

    cdlr_val = sum(float(s.get("value_nok") or 0.0) for s in stocks if s.get("ticker") == "CDLR.OL" and s.get("in_portfolio"))
    mobile_portfolio_nok = round(total_portfolio_nok - cdlr_val, 2)
    total_portfolio_nok = round(total_portfolio_nok, 2)
    total_prev_nok = round(total_prev_nok, 2)

    for s in stocks:
        if s.get("in_portfolio") and total_portfolio_nok > 0:
            w = round((float(s.get("value_nok") or 0.0) / total_portfolio_nok) * 100.0, 2)
            s["weight_pct"] = w
            if w > 15.0:
                s["rule_status"] = f"BRUDD (> 15 %: {w:.2f} %)"
            elif w >= 12.0:
                s["rule_status"] = "Nær taket (12–15 %)"
            elif "kvalitetskrav" not in (s.get("rule_status") or "").lower() and "tvangsinnløsning" not in (s.get("rule_status") or "").lower():
                s["rule_status"] = "Innenfor (< 15 %)"

    meta = data.setdefault("metadata", {})
    cash_nok = float(meta.get("cash_nok") or 33.15)
    cost_basis_nok = float(meta.get("cost_basis_nok") or 378828.17)
    day_change_nok = round(total_portfolio_nok - total_prev_nok, 2)
    day_change_pct = round(((total_portfolio_nok / total_prev_nok) - 1.0) * 100.0, 2) if total_prev_nok > 0 else 0.0

    meta["updated_at"] = now_oslo.isoformat(timespec="seconds")
    meta["portfolio_value_nok"] = total_portfolio_nok
    meta["mobile_visible_value_nok"] = mobile_portfolio_nok
    meta["cadeler_squeeze_out_nok"] = round(cdlr_val, 2)
    meta["total_value_nok"] = round(total_portfolio_nok + cash_nok, 2)
    meta["day_change_nok"] = day_change_nok
    meta["day_change_pct"] = day_change_pct
    meta["unrealized_pnl_nok"] = round(total_portfolio_nok - cost_basis_nok, 2)
    meta["unrealized_pnl_pct"] = round(((total_portfolio_nok - cost_basis_nok) / cost_basis_nok) * 100.0, 2)

    today_str = now_oslo.strftime("%Y-%m-%d")
    daily_values = data.get("daily_values", [])
    if not daily_values:
        daily_values = [
            {
                "date": "2026-11-24",
                "portfolio_value_nok": 344223.40,
                "total_value_nok": 344256.55,
                "day_change_nok": -978.84,
                "day_change_pct": -0.28,
                "unrealized_pnl_nok": -34604.77,
            }
        ]
    today_entry = {
        "date": today_str,
        "updated_at": now_oslo.strftime("%H:%M CET"),
        "portfolio_value_nok": total_portfolio_nok,
        "mobile_visible_value_nok": mobile_portfolio_nok,
        "total_value_nok": meta["total_value_nok"],
        "day_change_nok": day_change_nok,
        "day_change_pct": day_change_pct,
        "unrealized_pnl_nok": meta["unrealized_pnl_nok"],
    }
    by_date = {d["date"]: d for d in daily_values if d.get("date")}
    by_date[today_str] = today_entry
    data["daily_values"] = sorted(by_date.values(), key=lambda x: x["date"], reverse=True)[:60]

    print(
        f"[OK] Oppdaterte kurser for {updated_count} aksjer og sesongmønster for {seasonality_count} aksjer. "
        f"Mobilverdi: {mobile_portfolio_nok:,.2f} NOK | Inkl. Cadeler: {total_portfolio_nok:,.2f} NOK"
    )


def format_newsweb_time(iso_str: str) -> str:
    if not iso_str:
        return ""
    try:
        dt = datetime.datetime.fromisoformat(iso_str.replace("Z", "+00:00")).astimezone(OSLO_TZ)
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return iso_str[:16].replace("T", " ")


def fetch_newsweb_messages(api_base: str, query_suffix: str = "", timeout: int = 10):
    url = f"{api_base}/v1/newsreader/list{query_suffix}"
    req = urllib.request.Request(
        url,
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read())
    return payload.get("data", {}).get("messages", [])


def update_oslo_bors_meldinger(data: dict):
    try:
        urls_info = json.loads(urllib.request.urlopen("https://newsweb.oslobors.no/urls.json", timeout=8).read())
        api_base = urls_info.get("api_large") or "https://api3.oslo.oslobors.no"
    except Exception:
        api_base = "https://api3.oslo.oslobors.no"

    stocks = data.get("stocks", [])
    portfolio_issuers = set()
    candidate_issuers = set(EXTRA_OSLO_ISSUERS)

    for s in stocks:
        ticker = s.get("ticker", "")
        if ticker.endswith(".OL"):
            issuer = ticker.split(".")[0]
            if s.get("in_portfolio"):
                portfolio_issuers.add(issuer)
            else:
                candidate_issuers.add(issuer)

    collected = {}

    def process_msg(m, default_relevance="OSLO_BORS_ELLERS"):
        msg_id = m.get("messageId") or m.get("id")
        if not msg_id:
            return
        issuer = (m.get("issuerSign") or "").strip().upper()
        title = (m.get("title") or "").strip()
        if not title:
            return
        cats = m.get("category") or []
        cat_name = cats[0].get("category_no", "BØRSMELDING") if cats and isinstance(cats, list) else "BØRSMELDING"

        in_port = issuer in portfolio_issuers
        is_cand = issuer in candidate_issuers

        if in_port:
            relevance = "MINE_AKSJER"
        elif is_cand:
            relevance = "KANDIDATER"
        else:
            if BORSMELDING_NOISE_PATTERNS.search(title):
                return
            relevance = default_relevance

        pub_raw = m.get("publishedTime") or ""
        collected[int(msg_id)] = {
            "id": int(msg_id),
            "published": format_newsweb_time(pub_raw),
            "published_raw": pub_raw,
            "ticker": issuer,
            "issuer_name": (m.get("issuerName") or "").strip(),
            "category": cat_name,
            "title": title,
            "url": f"https://newsweb.oslobors.no/message/{msg_id}",
            "in_portfolio": in_port,
            "is_candidate": is_cand,
            "relevance": relevance,
        }

    try:
        general_msgs = fetch_newsweb_messages(api_base, "")
        for m in general_msgs:
            process_msg(m, "OSLO_BORS_ELLERS")
        print(f"[OK] Hentet {len(general_msgs)} generelle meldinger fra Oslo Børs NewsWeb")
    except Exception as e:
        print(f"[WARN] Kunne ikke hente generell NewsWeb-liste: {e}")

    tracked_issuers = sorted(portfolio_issuers) + sorted(candidate_issuers - portfolio_issuers)[:12]
    for issuer in tracked_issuers:
        try:
            issuer_msgs = fetch_newsweb_messages(api_base, f"?issuer={urllib.parse.quote(issuer)}")
            for m in issuer_msgs[:4]:
                process_msg(m)
        except Exception as e:
            print(f"[WARN] Kunne ikke hente NewsWeb for {issuer}: {e}")

    sorted_msgs = sorted(
        collected.values(),
        key=lambda x: x.get("published_raw", ""),
        reverse=True,
    )[:85]

    data["borsmeldinger"] = sorted_msgs
    print(f"[OK] Lagret {len(sorted_msgs)} børsmeldinger fra Oslo Børs NewsWeb.")


def detect_broker(text: str):
    for broker, pattern in BROKER_PATTERNS.items():
        if re.search(pattern, text, re.IGNORECASE):
            return broker
    return None


def detect_rating(text: str):
    for rating, pattern in RATING_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return rating
    return None


def detect_target(text: str):
    m = TARGET_REGEX.search(text)
    if not m:
        return None
    try:
        val = float(m.group(1).replace(",", "."))
        if 1.0 <= val <= 5000.0:
            return val
    except ValueError:
        pass
    return None


def detect_stock(text: str, stocks: list):
    text_lower = text.lower()
    for s in stocks:
        ticker_base = s["ticker"].split(".")[0].lower()
        name_clean = (
            s["name"]
            .replace("ASA", "")
            .replace("A/S", "")
            .replace("AB", "")
            .replace("Oyj", "")
            .replace("Ltd", "")
            .replace("Corp", "")
            .replace("ser. B", "")
            .strip()
            .lower()
        )
        if name_clean and len(name_clean) >= 3 and name_clean in text_lower:
            return s["ticker"]
        if len(ticker_base) >= 3 and re.search(rf"\b{re.escape(ticker_base)}\b", text, re.IGNORECASE):
            return s["ticker"]
    return None


def parse_pub_date(raw_date: str) -> str:
    if not raw_date:
        return datetime.date.today().isoformat()
    try:
        dt = parsedate_to_datetime(raw_date)
        return dt.date().isoformat()
    except Exception:
        return datetime.date.today().isoformat()


def fetch_rss_items(feed_url: str, timeout: int = 12):
    req = urllib.request.Request(
        feed_url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; NordiskPortefoljeBot/1.0; +https://github.com/rolldan/aksjer)"
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        xml_bytes = resp.read()
    root = ET.fromstring(xml_bytes)
    items = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = parse_pub_date(item.findtext("pubDate") or "")
        source_el = item.find("source")
        source = (source_el.text.strip() if source_el is not None and source_el.text else "")
        if title:
            items.append({"title": title, "link": link, "published": pub_date, "source": source})
    return items


def update_rss_news(data: dict, now_oslo: datetime.datetime):
    stocks = data.get("stocks", [])
    existing_news = {n.get("title"): n for n in data.get("news_feed", []) if n.get("title")}
    collected = []

    for feed in RSS_FEEDS:
        try:
            items = fetch_rss_items(feed["url"])
            print(f"[OK] Hentet {len(items)} saker fra {feed['name']}")
        except Exception as e:
            print(f"[WARN] Kunne ikke hente {feed['name']}: {e}")
            continue

        for item in items:
            title = item["title"]
            broker = detect_broker(title)
            ticker = detect_stock(title, stocks)
            rating = detect_rating(title)
            target = detect_target(title)

            if not (broker or ticker or "kursmål" in title.lower() or "riktkurs" in title.lower()):
                continue

            entry = {
                "published": item["published"],
                "source": item["source"] or feed["name"],
                "broker": broker,
                "title": title,
                "link": item["link"],
                "detected_ticker": ticker,
                "detected_rating": rating,
                "detected_target": target,
            }
            collected.append(entry)

    for entry in collected:
        existing_news[entry["title"]] = entry

    sorted_news = sorted(
        existing_news.values(),
        key=lambda x: x.get("published", ""),
        reverse=True,
    )[:40]

    data["news_feed"] = sorted_news
    data.setdefault("metadata", {})["last_rss_check"] = now_oslo.isoformat(timespec="seconds")


def main():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    now_oslo = datetime.datetime.now(OSLO_TZ)
    ensure_candidates_and_watchlist(data)
    update_prices_and_portfolio(data, now_oslo)
    update_oslo_bors_meldinger(data)
    update_rss_news(data, now_oslo)

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[FERDIG] Lagret oppdatert data i {DATA_PATH}")


if __name__ == "__main__":
    main()
