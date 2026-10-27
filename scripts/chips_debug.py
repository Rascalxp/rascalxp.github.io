import json
from common import session, save_json
out = {}
def probe(label, method, url, **kw):
    try:
        r = session.request(method, url, timeout=30, **kw)
        out[label] = {"status": r.status_code, "len": len(r.content), "ctype": r.headers.get("content-type"),
                      "server": r.headers.get("server"), "head": r.content[:600].decode("utf-8", "replace")}
    except Exception as e:
        out[label] = str(e)
probe("csv_range", "POST", "https://www.taifex.com.tw/cht/3/futContractsDateDown",
      data={"queryStartDate": "2026/10/14", "queryEndDate": "2026/10/27", "commodityId": "TMF"})
probe("html_day", "POST", "https://www.taifex.com.tw/cht/3/futContractsDate",
      data={"queryType": "1", "queryDate": "2026/10/22", "commodityId": "TMF"})
probe("www_home", "GET", "https://www.taifex.com.tw/cht/index")
try:
    r = session.get("https://openapi.taifex.com.tw/swagger.json", timeout=30)
    sw = r.json()
    out["openapi_status"] = r.status_code
    out["openapi_paths"] = {p: (v.get("get", {}).get("summary") or v.get("get", {}).get("description") or "") for p, v in sw.get("paths", {}).items()}
except Exception as e:
    out["openapi"] = str(e)
probe("openapi_inst", "GET", "https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate")
probe("twse_today", "GET", "https://www.twse.com.tw/rwd/zh/fund/BFI82U", params={"type": "day", "dayDate": "20261027", "response": "json"})
save_json("chips_debug.json", out)
