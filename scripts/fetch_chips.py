"""抓三大法人買賣金額（證交所）與散戶微台未平倉（期交所），寫入 data/chips.json。

散戶微台的算法（業界常用）：
  散戶多單 = 微台全市場未平倉 − 三大法人多單
  散戶空單 = 微台全市場未平倉 − 三大法人空單
  散戶淨未平倉 = 散戶多單 − 散戶空單 = −（三大法人多空未平倉淨額）
口數增減 = 今日散戶淨未平倉 − 前一交易日散戶淨未平倉
"""
import csv
import io
import re
import sys
import time
from datetime import timedelta

from common import log_error, write_status, load_json, now_iso, now_tw, save_json, session, to_int

TWSE_URL = "https://www.twse.com.tw/rwd/zh/fund/BFI82U"
TAIFEX_CSV_URL = "https://www.taifex.com.tw/cht/3/futContractsDateDown"
TAIFEX_OPENAPI_URL = ("https://openapi.taifex.com.tw/v1/"
                      "MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate")
TMF = "TMF"  # 微型臺指期貨
LOOKBACK_DAYS = 12


# ---------- 證交所：三大法人買賣金額 ----------

def fetch_twse_day(day):
    params = {"type": "day", "dayDate": day.strftime("%Y%m%d"), "response": "json"}
    r = session.get(TWSE_URL, params=params, timeout=30)
    r.raise_for_status()
    js = r.json()
    if js.get("stat") != "OK" or not js.get("data"):
        return None
    fields = js.get("fields") or ["單位名稱", "買進金額", "賣出金額", "買賣差額"]
    rows = [dict(zip(fields, row)) for row in js["data"]]

    def pick(*keywords):
        buy = sell = net = 0
        found = False
        for row in rows:
            name = row.get(fields[0], "")
            if any(k in name for k in keywords):
                found = True
                buy += to_int(row.get(fields[1])) or 0
                sell += to_int(row.get(fields[2])) or 0
                net += to_int(row.get(fields[3])) or 0
        return {"buy": buy, "sell": sell, "net": net} if found else None

    foreign = pick("外資")            # 外資及陸資(不含外資自營商) + 外資自營商
    trust = pick("投信")
    dealer = None
    dealer_rows = [r for r in rows if r.get(fields[0], "").startswith("自營商")]
    if dealer_rows:
        dealer = {
            "buy": sum(to_int(r.get(fields[1])) or 0 for r in dealer_rows),
            "sell": sum(to_int(r.get(fields[2])) or 0 for r in dealer_rows),
            "net": sum(to_int(r.get(fields[3])) or 0 for r in dealer_rows),
        }
    total = pick("合計")
    if not (foreign and trust and dealer):
        raise ValueError(f"證交所欄位和預期不同：{[r.get(fields[0]) for r in rows]}")
    return {
        "date": day.strftime("%Y-%m-%d"),
        "unit": "元",
        "rows": [
            {"name": "外資", **foreign},
            {"name": "投信", **trust},
            {"name": "自營商", **dealer},
            {"name": "三大法人合計", **(total or {
                "buy": foreign["buy"] + trust["buy"] + dealer["buy"],
                "sell": foreign["sell"] + trust["sell"] + dealer["sell"],
                "net": foreign["net"] + trust["net"] + dealer["net"],
            })},
        ],
    }


def latest_institutional():
    day = now_tw()
    for _ in range(LOOKBACK_DAYS):
        if day.weekday() < 5:
            result = fetch_twse_day(day)
            if result:
                return result
            time.sleep(2)  # 證交所有頻率限制，慢慢來
        day -= timedelta(days=1)
    return None


# ---------- 期交所：微台三大法人未平倉 ----------

def _decode(content):
    for enc in ("utf-8-sig", "cp950", "big5"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _parse_tmf_rows(text):
    """解析期交所「三大法人－區分各期貨契約」CSV（官網下載和 OpenAPI 格式相同）。

    回傳 {日期: 三大法人微台多空未平倉淨額}。三種身份要到齊、而且當天有成交量才算，
    避免把還沒公布或休市的日期當成 0。
    """
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        return {}
    header = [h.strip().lstrip("\ufeff") for h in rows[0]]

    def col(*keys):
        for i, h in enumerate(header):
            if all(k in h for k in keys):
                return i
        raise ValueError(f"期交所欄位和預期不同：{header}")

    i_date, i_name, i_who = col("日期"), col("商品"), col("身份")
    i_long, i_short = col("多方", "交易口數"), col("空方", "交易口數")
    i_net = col("未平倉", "淨額", "口數")

    by_day = {}
    for row in rows[1:]:
        if len(row) <= i_net or not re.search(r"微型|微台|微臺", row[i_name]):
            continue
        if not any(k in row[i_who] for k in ("自營商", "投信", "外資")):
            continue
        net = to_int(row[i_net])
        digits = re.sub(r"\D", "", row[i_date])
        if net is None or len(digits) != 8:
            continue
        day = f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"
        g = by_day.setdefault(day, {"net": 0, "count": 0, "volume": 0})
        g["net"] += net
        g["count"] += 1
        g["volume"] += (to_int(row[i_long]) or 0) + (to_int(row[i_short]) or 0)
    return {d: g["net"] for d, g in by_day.items() if g["count"] == 3 and g["volume"] > 0}


def tmf_from_taifex():
    # 一次抓最近 20 天，只發一個請求，避免被期交所的防火牆擋
    end = now_tw()
    start = end - timedelta(days=20)
    data = {"queryStartDate": f"{start:%Y/%m/%d}", "queryEndDate": f"{end:%Y/%m/%d}", "commodityId": TMF}
    r = session.post(TAIFEX_CSV_URL, data=data, timeout=30)
    r.raise_for_status()
    return _parse_tmf_rows(_decode(r.content))


def tmf_from_openapi():
    # 備用：期交所 OpenAPI，只有最新一天，而且更新比官網慢
    r = session.get(TAIFEX_OPENAPI_URL, timeout=30)
    r.raise_for_status()
    return _parse_tmf_rows(_decode(r.content))


def latest_retail_tmf(history):
    """回傳（散戶微台資料, 更新後的歷史紀錄）。歷史紀錄用來在只拿到一天資料時計算口數增減。"""
    found = {}
    for fn in (tmf_from_taifex, tmf_from_openapi):
        try:
            found = fn()
            if found:
                break
            log_error(f"{fn.__name__}：沒有可用的資料")
        except Exception as e:  # noqa: BLE001 — 一個來源失敗就換下一個
            log_error(f"{fn.__name__} 失敗：{e}")
    if not found:
        return None, history

    merged = {**history, **found}
    days = sorted(merged)[-30:]
    history = {d: merged[d] for d in days}
    latest = days[-1]
    prev = days[-2] if len(days) > 1 else None
    retail = -history[latest]
    return {
        "date": latest,
        "net_oi": retail,
        "change": retail - (-history[prev]) if prev else None,
        "prev_date": prev,
    }, history


def main():
    out = load_json("chips.json", {})
    ok = False

    try:
        inst = latest_institutional()
        if inst:
            out["institutional"] = inst
            ok = True
            print(f"三大法人：{inst['date']}")
        else:
            log_error("三大法人：找不到資料")
    except Exception as e:  # noqa: BLE001
        log_error(f"三大法人抓取失敗：{e}")

    try:
        tmf, out["tmf_history"] = latest_retail_tmf(out.get("tmf_history", {}))
        if tmf:
            out["retail_tmf"] = tmf
            ok = True
            print(f"散戶微台：{tmf['date']} {tmf['change']} ({tmf['net_oi']})")
        else:
            log_error("散戶微台：找不到資料")
    except Exception as e:  # noqa: BLE001
        log_error(f"散戶微台抓取失敗：{e}")

    write_status("chips", ok)
    if ok:
        out["updated"] = now_iso()
        save_json("chips.json", out)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
