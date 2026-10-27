import json, re
from common import session, save_json
from fetch_media import _json_after, _walk, YT_COOKIES
out = {}
for name, cid in {"達人秀": "UCQvsuaih5lE0n_Ne54nNezg", "錢線": "UC_ObC9O0ZQ2FhW6u9_iFlZA"}.items():
    d = {}
    for tab in ("videos", "streams"):
        r = session.get(f"https://www.youtube.com/channel/{cid}/{tab}", timeout=30, cookies=YT_COOKIES)
        data = _json_after(r.text, "ytInitialData") or {}
        rows = []
        def visit(o):
            lv = o.get("lockupViewModel")
            if lv and len(rows) < 6:
                s = json.dumps(lv, ensure_ascii=False)
                md = lv.get("metadata", {}).get("lockupMetadataViewModel", {})
                parts = [p.get("text", {}).get("content") for row in md.get("metadata", {}).get("contentMetadataViewModel", {}).get("metadataRows", []) for p in row.get("metadataParts", [])]
                badges = re.findall(r'"(?:text|badgeStyle|style)": "([^"]{0,40})"', s)
                rows.append({"id": lv.get("contentId"), "title": md.get("title", {}).get("content", "")[:40], "parts": parts, "badges": [b for b in badges if "BADGE" in b or "會員" in b or "直播" in b][:8]})
        _walk(data, visit)
        d[tab] = rows
    vid = d["videos"][0]["id"] if d["videos"] else None
    if vid:
        r = session.get("https://www.youtube.com/watch", params={"v": vid}, timeout=30, cookies=YT_COOKIES)
        t = r.text
        pr = _json_after(t, "ytInitialPlayerResponse") or {}
        idata = _json_after(t, "ytInitialData") or {}
        sec = []
        _walk(idata, lambda o: sec.append(o["videoSecondaryInfoRenderer"]) if "videoSecondaryInfoRenderer" in o else None)
        prim = []
        _walk(idata, lambda o: prim.append(o["videoPrimaryInfoRenderer"]) if "videoPrimaryInfoRenderer" in o else None)
        d["watch"] = {"status": r.status_code, "len": len(t), "has_pr": "ytInitialPlayerResponse" in t, "pr_keys": list(pr.keys()),
                      "playability": pr.get("playabilityStatus", {}).get("status"), "reason": pr.get("playabilityStatus", {}).get("reason"),
                      "has_vd": "videoDetails" in pr, "has_mf": "microformat" in pr,
                      "publishDate_re": re.findall(r'"publishDate":"([^"]+)"', t)[:2], "uploadDate_re": re.findall(r'"uploadDate":"([^"]+)"', t)[:2],
                      "shortDesc_re": [x[:120] for x in re.findall(r'"shortDescription":"((?:[^"\\]|\\.)*)"', t)[:1]],
                      "sec": json.dumps(sec[0], ensure_ascii=False)[:800] if sec else None,
                      "prim_date": json.dumps(prim[0].get("dateText"), ensure_ascii=False) if prim else None,
                      "head": t[:300] if len(t) < 5000 else None}
    out[name] = d
save_json("yt_debug.json", out)
