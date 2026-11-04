"""抓上市類股漲跌與資金流向（證交所），寫入 data/sectors.json。

資料來源：
  - 類股漲跌幅：每日收盤行情（MI_INDEX）裡的各類股價格指數
  - 類股成交金額：各類指數日成交量值（BFIAMU），和前一交易日比較就是資金流向
  - 個股行情：同一份 MI_INDEX 的「每日收盤行情」
  - 個股所屬產業：證交所 OpenAPI 上市公司基本資料（t187ap03_L）

成交比重 = 該類股成交金額 ÷ 所有類股成交金額合計（不含 ETF、權證等）。
比重變化 = 今日比重 − 前一交易日比重，正數代表資金流入、負數代表流出。
"""
import re
import sys
import time
from datetime import timedelta

from common import load_json, log_error, now_iso, now_tw, save_json, session, to_int, write_status

MI_INDEX_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"
BFIAMU_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/BFIAMU"
COMPANY_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
LOOKBACK_DAYS = 12
TOP_N = 5

# 證交所產業別代碼 → 類股名稱（和類股指數名稱去掉「類指數」後相同）
SECTORS = {
    "01": "水泥", "02": "食品", "03": "塑膠", "04": "紡織纖維", "05": "電機機械",
    "06": "電器電纜", "21": "化學", "22": "生技醫療", "08": "玻璃陶瓷", "09": "造紙",
    "10": "鋼鐵", "11": "橡膠", "12": "汽車", "24": "半導體", "25": "電腦及週邊設備",
    "26": "光電", "27": "通信網路", "28": "電子零組件", "29": "電子通路", "30": "資訊服務",
    "31": "其他電子", "14": "建材營造", "15": "航運", "16": "觀光餐旅", "17": "金融保險",
    "18": "貿易百貨", "23": "油電燃氣", "35": "綠能環保", "36": "數位雲端", "37": "運動休閒",
    "38": "居家生活", "20": "其他",
}
NAME_TO_CODE = {v: k for k, v in SECTORS.items()}


def norm_sector(name):
    """'航運業類指數   ' / '航運類指數' → '航運'。"""
    s = re.sub(r"\s", "", name or "").replace("類指數", "")
    return s[:-1] if s.endswith("業") and s[:-1] in NAME_TO_CODE else s


def to_float(text):
    s = str(text).replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def sign_of(cell):
    """證交所的漲跌欄是 HTML，例如 <p style= color:red>+</p>。"""
    text = re.sub(r"<[^>]+>", "", str(cell)).strip()
    if "+" in text:
        return 1
    if "-" in text:
        return -1
    if text == "" or text == " ":
        return 0
    return None  # X（除權息等）無法直接比較，略過


def get_json(url, params):
    r = session.get(url, params=params, timeout=40)
    r.raise_for_status()
    js = r.json()
    time.sleep(3)  # 證交所有頻率限制，慢慢來
    return js if js.get("stat") == "OK" else None


# ---------- 抓資料 ----------

def fetch_mi_index(day):
    return get_json(MI_INDEX_URL, {"date": day.strftime("%Y%m%d"), "type": "ALLBUT0999", "response": "json"})


def fetch_bfiamu(day):
    return get_json(BFIAMU_URL, {"date": day.strftime("%Y%m%d"), "response": "json"})


def fetch_industry_map():
    """{股票代號: 產業別代碼}。抓不到就用上次存下來的。"""
    cached = load_json("industry.json", {})
    try:
        r = session.get(COMPANY_URL, timeout=60)
        r.raise_for_status()
        rows = r.json()
        mapping = {str(x.get("公司代號", "")).strip(): str(x.get("產業別", "")).strip() for x in rows}
        mapping = {k: v for k, v in mapping.items() if k and v}
        if len(mapping) > 500:
            if mapping != cached:
                save_json("industry.json", mapping)
            return mapping
        log_error(f"上市公司基本資料筆數太少（{len(mapping)}），改用快取")
    except Exception as e:  # noqa: BLE001
        log_error(f"上市公司基本資料抓取失敗，改用快取：{e}")
    return cached


# ---------- 解析 ----------

def find_table(js, *field_keys):
    for t in js.get("tables") or []:
        fields = t.get("fields") or []
        if all(any(k in f for f in fields) for k in field_keys) and t.get("data"):
            return fields, t["data"]
    return None, None


def parse_sector_index(js):
    """{類股名稱: {'close':…, 'change_pct':…}}。"""
    out = {}
    for t in js.get("tables") or []:
        fields = t.get("fields") or []
        if not fields or "指數" not in fields[0] or "報酬" in fields[0]:
            continue
        idx = {f: i for i, f in enumerate(fields)}
        i_pct = next((i for f, i in idx.items() if "百分比" in f), None)
        i_close = next((i for f, i in idx.items() if "收盤" in f), None)
        i_sign = next((i for f, i in idx.items() if "+/-" in f), None)
        if i_pct is None:
            continue
        for row in t.get("data") or []:
            name = norm_sector(row[0])
            if name not in NAME_TO_CODE or name in out:
                continue
            pct = to_float(row[i_pct])
            if pct is None:
                continue
            # 百分比欄通常已帶正負號；沒有的話再看漲跌欄
            if pct > 0 and i_sign is not None and sign_of(row[i_sign]) == -1:
                pct = -pct
            out[name] = {"close": to_float(row[i_close]) if i_close is not None else None, "change_pct": pct}
    return out


def parse_bfiamu(js):
    """{類股名稱: 成交金額}。"""
    fields = js.get("fields") or []
    i_value = next((i for i, f in enumerate(fields) if "成交金額" in f), 2)
    out = {}
    for row in js.get("data") or []:
        name = norm_sector(row[0])
        if name in NAME_TO_CODE:
            out[name] = to_int(row[i_value]) or 0
    return out


def parse_stocks(js):
    fields, data = find_table(js, "證券代號", "收盤價", "成交金額")
    if not data:
        raise ValueError("MI_INDEX 找不到每日收盤行情表")
    idx = {f: i for i, f in enumerate(fields)}

    def col(key):
        return next(i for f, i in idx.items() if key in f)

    i_code, i_name = col("證券代號"), col("證券名稱")
    i_value, i_vol = col("成交金額"), col("成交股數")
    i_high, i_close = col("最高價"), col("收盤價")
    i_sign, i_diff = col("+/-"), col("漲跌價差")

    stocks = []
    for row in data:
        close = to_float(row[i_close])
        diff = to_float(row[i_diff])
        sign = sign_of(row[i_sign])
        if close is None or diff is None or sign is None:
            continue
        change = sign * diff
        ref = close - change
        if ref <= 0:
            continue
        pct = round(change / ref * 100, 2)
        high = to_float(row[i_high])
        stocks.append({
            "code": row[i_code].strip(),
            "name": row[i_name].strip(),
            "close": close,
            "change": round(change, 2),
            "change_pct": pct,
            "value": to_int(row[i_value]) or 0,
            "volume": to_int(row[i_vol]) or 0,
            "limit_up": pct >= 9.4 and high is not None and close >= high,
        })
    return stocks


# ---------- 組合 ----------

def build(day, mi, bf, bf_prev, prev_day, industry):
    index = parse_sector_index(mi)
    value = parse_bfiamu(bf) if bf else {}
    prev_value = parse_bfiamu(bf_prev) if bf_prev else {}
    stocks = parse_stocks(mi)

    total = sum(value.values())
    prev_total = sum(prev_value.values())

    by_sector = {}
    for s in stocks:
        code = industry.get(s["code"])
        if code in SECTORS:
            by_sector.setdefault(SECTORS[code], []).append(s)

    sectors = []
    for name in SECTORS.values():
        if name not in index:
            continue
        members = by_sector.get(name, [])
        traded = [s for s in members if s["volume"] > 0]
        top = sorted(traded, key=lambda s: (s["change_pct"], s["value"]), reverse=True)[:TOP_N]
        # 成交金額最大的個股：類股指數和多數個股方向不同時，前端用它說明原因
        member_value = sum(s["value"] for s in traded)
        big = max(traded, key=lambda s: s["value"]) if traded else None
        leader = {
            "code": big["code"], "name": big["name"], "change_pct": big["change_pct"],
            "value_share": round(big["value"] / member_value * 100, 1),
        } if big and member_value else None
        v = value.get(name)
        pv = prev_value.get(name)
        share = v / total * 100 if v is not None and total else None
        prev_share = pv / prev_total * 100 if pv is not None and prev_total else None
        sectors.append({
            "name": name,
            "index_close": index[name]["close"],
            "change_pct": index[name]["change_pct"],
            "value": v,
            "prev_value": pv,
            "share": round(share, 2) if share is not None else None,
            "share_change": round(share - prev_share, 2) if share is not None and prev_share is not None else None,
            "count": len(members),
            "up": sum(1 for s in traded if s["change_pct"] > 0),
            "down": sum(1 for s in traded if s["change_pct"] < 0),
            "leader": leader,
            "top": [{k: s[k] for k in ("code", "name", "close", "change", "change_pct", "value", "limit_up")} for s in top],
        })

    sectors.sort(key=lambda s: s["change_pct"], reverse=True)
    taiex = None
    for t in mi.get("tables") or []:
        for row in t.get("data") or []:
            if row and row[0].strip() == "發行量加權股價指數":
                pct = to_float(row[4]) if len(row) > 4 else None
                taiex = {"close": to_float(row[1]), "change_pct": pct}
                break
        if taiex:
            break

    return {
        "date": day.strftime("%Y-%m-%d"),
        "prev_date": prev_day.strftime("%Y-%m-%d") if prev_day else None,
        "market": "上市",
        "taiex": taiex,
        "total_value": total,
        "prev_total_value": prev_total or None,
        "sectors": sectors,
    }


def latest_trading_day():
    day = now_tw()
    for _ in range(LOOKBACK_DAYS):
        if day.weekday() < 5:
            mi = fetch_mi_index(day)
            if mi and parse_sector_index(mi):
                return day, mi
        day -= timedelta(days=1)
    return None, None


def previous_bfiamu(day):
    d = day - timedelta(days=1)
    for _ in range(LOOKBACK_DAYS):
        if d.weekday() < 5:
            js = fetch_bfiamu(d)
            if js and parse_bfiamu(js):
                return d, js
        d -= timedelta(days=1)
    return None, None


def main():
    old = load_json("sectors.json", {})
    ok = False
    try:
        day, mi = latest_trading_day()
        if not day:
            raise RuntimeError("找不到最近交易日的收盤行情")
        bf = fetch_bfiamu(day)
        if not bf:
            log_error(f"{day:%Y-%m-%d} 類股成交金額尚未公布")
        prev_day, bf_prev = previous_bfiamu(day)
        industry = fetch_industry_map()
        if not industry:
            raise RuntimeError("沒有個股產業分類資料")
        out = build(day, mi, bf, bf_prev, prev_day, industry)
        if len(out["sectors"]) < 20:
            raise ValueError(f"類股數量太少（{len(out['sectors'])}），可能是證交所格式改了")
        ok = True
        print(f"類股資金流向：{out['date']}，{len(out['sectors'])} 類")
        if {k: v for k, v in old.items() if k != "updated"} != out:
            out["updated"] = now_iso()
            save_json("sectors.json", out)
        else:
            print("資料沒有變動")
    except Exception as e:  # noqa: BLE001
        log_error(f"類股資金流向抓取失敗：{e}")

    write_status("sectors", ok)
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
