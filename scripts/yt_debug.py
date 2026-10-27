import json, re
from collections import Counter
from common import session, save_json
ids = {"老先覺": "UCmmwEtaTI22K7o2IJFedS5w", "達人秀": "UCQvsuaih5lE0n_Ne54nNezg", "錢線": "UC_ObC9O0ZQ2FhW6u9_iFlZA"}

def initial_data(html):
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    return json.loads(m.group(1)) if m else None

def walk(o, fn):
    if isinstance(o, dict):
        fn(o)
        for v in o.values(): walk(v, fn)
    elif isinstance(o, list):
        for v in o: walk(v, fn)

out = {}
for name, cid in ids.items():
    d = {}
    for tab in ("videos", "streams"):
        r = session.get(f"https://www.youtube.com/channel/{cid}/{tab}", timeout=30, cookies={"CONSENT": "YES+1"})
        data = initial_data(r.text)
        if not data:
            d[tab] = "no ytInitialData"; continue
        keys = Counter(); tabs = []; lockups = []
        def fn(o):
            for k in o:
                if k.endswith("Renderer") or k.endswith("ViewModel"): keys[k] += 1
            if "tabRenderer" in o:
                t = o["tabRenderer"]; tabs.append([t.get("title"), t.get("selected", False), t.get("endpoint", {}).get("commandMetadata", {}).get("webCommandMetadata", {}).get("url")])
            if "lockupViewModel" in o: lockups.append(o["lockupViewModel"])
            if "videoRenderer" in o: lockups.append({"VR": o["videoRenderer"]})
        walk(data, fn)
        d[tab] = {"final_url": r.url, "tabs": tabs, "keys": keys.most_common(40), "n_lockups": len(lockups), "first": lockups[0] if lockups else None, "second": lockups[1] if len(lockups) > 1 else None}
    out[name] = d
save_json("yt_debug.json", out)
