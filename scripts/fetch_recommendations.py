#!/usr/bin/env python3
"""
Henter nye børsmeldinger og finansnyheter om kursmål og anbefalinger fra norske/nordiske
finansmedier og Google News RSS for meglerhusene, og oppdaterer data/recommendations.json.
Bruker kun Python standardbibliotek (ingen eksterne pip-pakker kreves).
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


def main():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

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
    now_oslo = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1)))
    data.setdefault("metadata", {})["last_rss_check"] = now_oslo.isoformat(timespec="seconds")

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[FERDIG] Oppdaterte {DATA_PATH} med {len(sorted_news)} relevante finansnyheter.")


if __name__ == "__main__":
    main()
