#!/usr/bin/env python3
"""
Oppdaterer data/recommendations.json hver time:
1. Henter siste aksjekurser og dagens kursendring fra Yahoo Finance (OSE, SSE, CSE, HEX) + valutakurser (SEK, DKK, EUR -> NOK).
2. Beregner aktuell porteføljeverdi i NOK, dagens endring i NOK/%, urealisert resultat, porteføljevekter, sektorvekter og oppside til kursmål.
3. Lagrer daglig verdiutvikling i daily_values.
4. Henter siste børsmeldinger fra Oslo Børs NewsWeb API (både for porteføljeaksjer, kandidater og interessante meldinger på Oslo Børs).
5. Henter siste finansnyheter om kursmål og anbefalinger fra RSS (Google News NO/SE og E24).
"""

import datetime
import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(BASE_DIR, "data", "recommendations.json")

OSLO_TZ = datetime.timezone(datetime.timedelta(hours=1))

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
    for s in stocks:
        ticker = s.get("ticker", "")
        if not ticker or ticker == "PLCS":
            continue
        # Cadeler A/S (440 aksjer) er under tvangsinnløsning (Squeeze-out) til fast kontantkurs 58,42 NOK (frist 07.12.2026)
        if ticker == "CDLR.OL" and s.get("squeeze_out_price"):
            s["price"] = float(s["squeeze_out_price"])
            s["prev_close"] = float(s["squeeze_out_price"])
            s["day_change_pct"] = 0.0
            s["price_updated_at"] = "Fast innløsningskurs (58,42 NOK)"
            continue
        try:
            q = fetch_yahoo_quote(ticker)
            if q and q.get("price"):
                s["price"] = q["price"]
                s["prev_close"] = q["prev_close"]
                s["day_change_pct"] = q["day_change_pct"]
                s["price_updated_at"] = now_oslo.strftime("%Y-%m-%d %H:%M CET")
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

    # Beregn både verdi som vises i DNB-mobilappen (uten suspendert Cadeler A/S) og total reell verdi inkl. Cadeler-innløsning (25 704,80 NOK)
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
            elif "kvalitetskrav" not in (s.get("rule_status") or "").lower():
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

    # Oppdater daglig verdi-historikk
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
        "total_value_nok": meta["total_value_nok"],
        "day_change_nok": day_change_nok,
        "day_change_pct": day_change_pct,
        "unrealized_pnl_nok": meta["unrealized_pnl_nok"],
    }
    by_date = {d["date"]: d for d in daily_values if d.get("date")}
    by_date[today_str] = today_entry
    data["daily_values"] = sorted(by_date.values(), key=lambda x: x["date"], reverse=True)[:60]

    print(f"[OK] Oppdaterte kurser for {updated_count} aksjer. Porteføljeverdi: {total_portfolio_nok:,.2f} NOK ({day_change_pct:+.2f} % i dag)")


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

    # 1. Hent siste meldinger på tvers av hele Oslo Børs
    try:
        general_msgs = fetch_newsweb_messages(api_base, "")
        for m in general_msgs:
            process_msg(m, "OSLO_BORS_ELLERS")
        print(f"[OK] Hentet {len(general_msgs)} generelle meldinger fra Oslo Børs NewsWeb")
    except Exception as e:
        print(f"[WARN] Kunne ikke hente generell NewsWeb-liste: {e}")

    # 2. Hent de siste meldingene spesifikt for porteføljeaksjer og utvalgte kandidater på Oslo Børs
    tracked_issuers = sorted(portfolio_issuers) + sorted(candidate_issuers - portfolio_issuers)[:10]
    for issuer in tracked_issuers:
        try:
            issuer_msgs = fetch_newsweb_messages(api_base, f"?issuer={urllib.parse.quote(issuer)}")
            # Ta de 4 nyeste meldingene per selskap
            for m in issuer_msgs[:4]:
                process_msg(m)
        except Exception as e:
            print(f"[WARN] Kunne ikke hente NewsWeb for {issuer}: {e}")

    sorted_msgs = sorted(
        collected.values(),
        key=lambda x: x.get("published_raw", ""),
        reverse=True,
    )[:80]

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
    update_prices_and_portfolio(data, now_oslo)
    update_oslo_bors_meldinger(data)
    update_rss_news(data, now_oslo)

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[FERDIG] Lagret oppdatert data i {DATA_PATH}")


if __name__ == "__main__":
    main()
