#!/usr/bin/env python3
"""Poll a news API for Fabrizio Romano transfer news and push "HERE WE GO" /
confirmed-deal items to a Telegram chat. Designed to run on a cron (GitHub
Actions or launchd). State (already-sent article IDs) is kept in state.json so
the same story is never sent twice.

Required environment variables:
  TELEGRAM_BOT_TOKEN   Bot HTTP API token from @BotFather
  TELEGRAM_CHAT_ID     Your chat id (numeric)
  NEWS_API_KEY         API key for the news provider
Optional:
  NEWS_PROVIDER        "newsdata" (default) or "gnews"
  JOURNALIST           Search phrase (default "Fabrizio Romano")
  STATE_FILE           Path to state file (default state.json next to script)
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

# Only forward items whose title/description mentions one of these. Keeps the
# feed to confirmed transfers + "here we go" moments instead of every mention.
KEYWORDS = [
    "here we go",
    "confirmed",
    "official",
    "done deal",
    "medical",
    "signs",
    "signed",
    "completes",
    "completed",
    "agreement reached",
    "deal done",
    "joins",
]

# Journalists we follow (for reference / display). The actual API search uses
# NEWS_QUERY below. NOTE: newsdata.io's free tier caps the q string at 100
# chars, so Romano is fully qualified and the rest use their (distinctive)
# surnames to stay under the limit while still matching.
JOURNALISTS = [
    "Fabrizio Romano",
    "David Ornstein",
    "Gianluca Di Marzio",
    "Matteo Moretto",
    "David Amoyal",
    "Florian Plettenberg",
]
NEWS_QUERY = os.environ.get(
    "NEWS_QUERY",
    '"Fabrizio Romano" OR Ornstein OR "Di Marzio" OR Moretto OR Amoyal OR Plettenberg',
)
PROVIDER = os.environ.get("NEWS_PROVIDER", "newsdata").lower()
STATE_FILE = Path(os.environ.get("STATE_FILE", Path(__file__).with_name("state.json")))
MAX_STATE = 500  # cap remembered IDs so state.json doesn't grow forever


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "romano-bot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def fetch_articles():
    """Return a list of {id, title, desc, url, source} from the news provider."""
    key = os.environ["NEWS_API_KEY"]
    if PROVIDER == "gnews":
        q = urllib.parse.quote(NEWS_QUERY)
        url = (
            f"https://gnews.io/api/v4/search?q={q}&lang=en&max=25"
            f"&sortby=publishedAt&apikey={key}"
        )
        data = _get_json(url)
        out = []
        for a in data.get("articles", []):
            out.append({
                "id": a.get("url"),
                "title": a.get("title") or "",
                "desc": a.get("description") or "",
                "url": a.get("url") or "",
                "source": (a.get("source") or {}).get("name", ""),
            })
        return out

    # default: newsdata.io
    q = urllib.parse.quote(NEWS_QUERY)
    url = (
        f"https://newsdata.io/api/1/news?apikey={key}&q={q}"
        f"&language=en&category=sports"
    )
    data = _get_json(url)
    if data.get("status") != "success":
        raise RuntimeError(f"newsdata error: {data}")
    out = []
    for a in data.get("results", []):
        out.append({
            "id": a.get("article_id") or a.get("link"),
            "title": a.get("title") or "",
            "desc": a.get("description") or "",
            "url": a.get("link") or "",
            "source": a.get("source_id", ""),
        })
    return out


def is_transfer(article):
    text = f"{article['title']} {article['desc']}".lower()
    return any(k in text for k in KEYWORDS)


def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {"sent": []}


def save_state(state):
    state["sent"] = state["sent"][-MAX_STATE:]
    STATE_FILE.write_text(json.dumps(state, indent=2))


def send_telegram(article):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    title = article["title"].strip()
    src = article["source"]
    text = f"⚽️ <b>{_esc(title)}</b>"
    if src:
        text += f"\n<i>{_esc(src)}</i>"
    if article["url"]:
        text += f'\n\n<a href="{article["url"]}">Read more</a>'
    payload = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "false",
    }).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=payload
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    state = load_state()
    sent = set(state["sent"])
    try:
        articles = fetch_articles()
    except Exception as e:  # noqa: BLE001
        print(f"fetch failed: {e}", file=sys.stderr)
        sys.exit(1)

    new_count = 0
    # oldest first so messages arrive in chronological order
    for article in reversed(articles):
        if not article["id"] or article["id"] in sent:
            continue
        if not is_transfer(article):
            continue
        result = send_telegram(article)
        if result.get("ok"):
            sent.add(article["id"])
            state["sent"].append(article["id"])
            new_count += 1
            print(f"sent: {article['title']}")
        else:
            print(f"telegram error: {result}", file=sys.stderr)

    save_state(state)
    print(f"done. {new_count} new item(s) sent, {len(articles)} scanned.")


if __name__ == "__main__":
    main()
