// ==========================================
// 共用工具：帶逾時控制的 fetch
// ==========================================
async function fetchWithTimeout(url, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

// ==========================================
// 1. 新竹縣新豐鄉氣象預報邏輯 (Open-Meteo API)
// ==========================================
function parseWmoCode(code) {
    if (code === 0) return { desc: "晴朗無雲", icon: "fa-sun text-amber-300", isSevere: false };
    if ([1, 2, 3].includes(code)) return { desc: "晴時多雲", icon: "fa-cloud-sun text-amber-200", isSevere: false };
    if ([45, 48].includes(code)) return { desc: "有霧 / 能見度低", icon: "fa-smog text-slate-300", isSevere: true, alertText: "濃霧能見度低警示" };
    if ([51, 53, 55, 61, 63, 80, 81].includes(code)) return { desc: "短暫陣雨", icon: "fa-cloud-rain text-sky-300", isSevere: false };
    if ([65, 82].includes(code)) return { desc: "大雨 / 強陣雨", icon: "fa-cloud-showers-heavy text-blue-300", isSevere: true, alertText: "豪大雨特報警示" };
    if ([95, 96, 99].includes(code)) return { desc: "雷陣雨", icon: "fa-cloud-bolt text-yellow-300", isSevere: true, alertText: "雷雨 / 強陣風警示" };
    return { desc: "多雲時晴", icon: "fa-cloud text-slate-200", isSevere: false };
}

export async function fetchXinfengWeather(isManual = false, notifyCallback = null) {
    const mainInfoEl = document.getElementById("weatherMainInfo");
    const alertBadgeEl = document.getElementById("weatherAlertBadge");
    const refreshIcon = document.getElementById("weatherRefreshIcon");

    if (isManual && refreshIcon) {
        refreshIcon.classList.add("fa-spin");
    }

    try {
        const url = "https://api.open-meteo.com/v1/forecast?latitude=24.8996&longitude=120.9854&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=Asia%2FTaipei&forecast_days=1";
        const res = await fetchWithTimeout(url, 6000);
        if (!res.ok) throw new Error("Weather API HTTP Error");
        const data = await res.json();

        const currentTemp = Math.round(data.current.temperature_2m);
        const currentCode = data.current.weather_code;
        const currentWind = Math.round(data.current.wind_speed_10m);

        const maxTemp = Math.round(data.daily.temperature_2m_max[0]);
        const minTemp = Math.round(data.daily.temperature_2m_min[0]);
        const pop = data.daily.precipitation_probability_max[0] ?? 0;
        const maxWind = Math.round(data.daily.wind_speed_10m_max[0] ?? currentWind);
        const dailyCode = data.daily.weather_code[0];

        const wInfo = parseWmoCode(currentCode);
        const dailyWInfo = parseWmoCode(dailyCode);

        mainInfoEl.innerHTML = `
            <span class="flex items-center gap-1 font-medium">
                <i class="fa-solid ${wInfo.icon}"></i>
                <span>${wInfo.desc}</span>
                <strong class="text-amber-300 font-mono text-xs sm:text-sm">${currentTemp}°C</strong>
            </span>
            <span class="text-slate-300 text-[11px]">
                (${minTemp}°~${maxTemp}°C)
            </span>
            <span class="flex items-center gap-1 text-sky-200 text-[11px]">
                <i class="fa-solid fa-umbrella text-sky-400"></i> <strong class="font-mono">${pop}%</strong>
            </span>
            <span class="flex items-center gap-1 text-teal-200 text-[11px]">
                <i class="fa-solid fa-wind text-teal-400"></i> <strong class="font-mono">${currentWind}</strong> km/h
            </span>
        `;

        let alerts = [];
        if (wInfo.isSevere && wInfo.alertText) alerts.push(wInfo.alertText);
        else if (dailyWInfo.isSevere && dailyWInfo.alertText) alerts.push(dailyWInfo.alertText);

        if (maxWind >= 35 || currentWind >= 35) {
            alerts.push(`強風特報 (${Math.max(maxWind, currentWind)} km/h)`);
        }
        if (pop >= 60 && !alerts.some(a => a.includes("雨"))) {
            alerts.push(`高降雨機率 (${pop}%)`);
        }
        if (maxTemp >= 34) {
            alerts.push(`高溫警示 (${maxTemp}°C)`);
        }
        if (minTemp <= 13) {
            alerts.push(`低溫特報 (${minTemp}°C)`);
        }

        if (alerts.length > 0) {
            alertBadgeEl.className = "flex items-center gap-1 bg-amber-500/20 text-amber-200 px-2 py-0.5 rounded-full border border-amber-400/50 text-[11px] font-medium animate-pulse";
            alertBadgeEl.innerHTML = `
                <i class="fa-solid fa-triangle-exclamation text-amber-400"></i>
                <span>${alerts.join("、")}</span>
            `;
        } else {
            alertBadgeEl.className = "flex items-center gap-1 bg-emerald-500/15 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-400/30 text-[11px]";
            alertBadgeEl.innerHTML = `
                <i class="fa-solid fa-circle-check text-emerald-400"></i>
                <span>無特殊天氣警示</span>
            `;
        }

        if (isManual && notifyCallback) notifyCallback("已更新新竹縣新豐鄉最新天氣預報");
    } catch (err) {
        console.error("Weather fetch failed:", err);
        mainInfoEl.innerHTML = `<span class="text-slate-300 text-xs">暫無法取得即時氣象</span>`;
        alertBadgeEl.className = "flex items-center gap-1 bg-white/10 text-slate-300 px-2 py-0.5 rounded-full border border-white/15 text-[11px]";
        alertBadgeEl.innerHTML = `<i class="fa-solid fa-circle-info text-slate-400"></i><span>氣象連線異常</span>`;
    } finally {
        if (refreshIcon) refreshIcon.classList.remove("fa-spin");
    }
}

// ==========================================
// 2. 今日台灣股票大盤指數 (多源並行競速架構)
// ==========================================
const TAIEX_CACHE_KEY = "taiex_last_quote_cache_v2";

// 若您有部署下方的 Google Apps Script 專屬代理網址，可貼在這裡作為最優先通道
const CUSTOM_GAS_TAIEX_URL = "";

function renderTaiexDisplay(quote) {
    const taiexEl = document.getElementById("taiexMainInfo");
    if (!taiexEl || !quote || isNaN(quote.price) || quote.price <= 1000) return false;

    const { price, prevClose, high, low, timeLabel } = quote;
    const diff = prevClose && !isNaN(prevClose) ? price - prevClose : 0;
    const pct = prevClose && prevClose > 0 ? (diff / prevClose) * 100 : 0;

    let colorClass = "text-slate-200";
    let badgeBg = "bg-white/10 border-white/15 text-slate-200";
    let arrowIcon = "—";

    if (diff > 0.005) {
        colorClass = "text-rose-400";
        badgeBg = "bg-rose-500/20 border-rose-400/40 text-rose-300";
        arrowIcon = "▲";
    } else if (diff < -0.005) {
        colorClass = "text-emerald-400";
        badgeBg = "bg-emerald-500/20 border-emerald-400/40 text-emerald-300";
        arrowIcon = "▼";
    }

    const formattedPrice = price.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedDiff = Math.abs(diff).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedPct = Math.abs(pct).toFixed(2);

    let rangeHtml = "";
    if (high && low && !isNaN(high) && !isNaN(low) && high > 0 && low > 0) {
        rangeHtml = `
            <span class="text-slate-300 text-[11px] hidden sm:inline">
                高低 <span class="font-mono">${Math.round(low).toLocaleString()}~${Math.round(high).toLocaleString()}</span>
            </span>
        `;
    }

    taiexEl.innerHTML = `
        <strong class="font-mono text-xs sm:text-sm font-bold ${colorClass}">${formattedPrice}</strong>
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[11px] font-semibold ${badgeBg}">
            <span>${arrowIcon} ${formattedDiff}</span>
            <span>(${diff >= 0 ? "+" : "-"}${formattedPct}%)</span>
        </span>
        ${rangeHtml}
        ${timeLabel ? `<span class="text-slate-400 text-[10px] font-mono">(${timeLabel})</span>` : ""}
    `;
    return true;
}

// 路線 A：自建 Google Apps Script 通道 (若有設定)
async function fetchFromCustomGas() {
    if (!CUSTOM_GAS_TAIEX_URL) throw new Error("No GAS URL");
    const res = await fetchWithTimeout(CUSTOM_GAS_TAIEX_URL, 6000);
    if (!res.ok) throw new Error("GAS HTTP error");
    const data = await res.json();
    if (!data || !data.price || data.price <= 1000) throw new Error("Invalid GAS data");
    return data;
}

// 路線 B：免代理直連 - 臺灣證券交易所 OpenAPI
async function fetchFromTwseDirect() {
    const res = await fetchWithTimeout("https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK", 6000);
    if (!res.ok) throw new Error("TWSE direct HTTP error");
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Empty TWSE rows");

    const latest = rows[rows.length - 1];
    const price = parseFloat(String(latest.TAIEX).replace(/,/g, ""));
    const change = parseFloat(String(latest.Change).replace(/,/g, ""));
    if (isNaN(price) || price <= 1000) throw new Error("Invalid TWSE price");

    const prevClose = !isNaN(change) ? price - change : price;
    return {
        price,
        prevClose,
        high: null,
        low: null,
        timeLabel: latest.Date ? `證交所 ${latest.Date}` : "證交所收盤"
    };
}

// 路線 C：免代理直連 - FinMind 台灣股市開放資料 API (原生支援 CORS)
async function fetchFromFinMindDirect() {
    const d = new Date();
    d.setDate(d.getDate() - 10);
    const startDate = d.toISOString().split("T")[0];
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=TAIEX&start_date=${startDate}`;

    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) throw new Error("FinMind HTTP error");
    const json = await res.json();
    const list = json?.data;
    if (!Array.isArray(list) || list.length === 0) throw new Error("Empty FinMind data");

    const latest = list[list.length - 1];
    const prev = list.length >= 2 ? list[list.length - 2] : null;
    const price = parseFloat(latest.close);
    if (isNaN(price) || price <= 1000) throw new Error("Invalid FinMind price");

    const prevClose = prev ? parseFloat(prev.close) : price - (parseFloat(latest.spread) || 0);
    return {
        price,
        prevClose,
        high: parseFloat(latest.max) || null,
        low: parseFloat(latest.min) || null,
        timeLabel: latest.date || "收盤"
    };
}

// 路線 D：JSONP (<script> 標籤注入，完全繞過瀏覽器 CORS 限制)
function fetchFromJsonpEastMoney() {
    return new Promise((resolve, reject) => {
        const cbName = "taiex_jsonp_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
        const script = document.createElement("script");
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("JSONP timeout"));
        }, 6000);

        function cleanup() {
            clearTimeout(timer);
            delete window[cbName];
            if (script.parentNode) script.parentNode.removeChild(script);
        }

        window[cbName] = (res) => {
            cleanup();
            try {
                const d = res?.data;
                if (!d || !d.f43) return reject(new Error("Empty JSONP data"));
                // f43=最新價, f44=最高, f45=最低, f60=昨收 (數值放大 100 倍)
                const price = Number(d.f43) / 100;
                const prevClose = d.f60 ? Number(d.f60) / 100 : price;
                const high = d.f44 ? Number(d.f44) / 100 : null;
                const low = d.f45 ? Number(d.f45) / 100 : null;

                if (isNaN(price) || price <= 1000) return reject(new Error("Invalid JSONP price"));
                resolve({ price, prevClose, high, low, timeLabel: "即時報價" });
            } catch (e) {
                reject(e);
            }
        };

        script.onerror = () => {
            cleanup();
            reject(new Error("JSONP script load error"));
        };

        script.src = `https://push2.eastmoney.com/api/qt/stock/get?secid=100.TWII&fields=f43,f44,f45,f60&cb=${cbName}&_=${Date.now()}`;
        document.head.appendChild(script);
    });
}

// 路線 E：Yahoo Finance 多代理並行
function parseYahooData(yfData) {
    const meta = yfData?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;

    const price = parseFloat(meta.regularMarketPrice);
    if (isNaN(price) || price <= 1000) return null;

    const prevClose = parseFloat(meta.chartPreviousClose || meta.previousClose);
    const high = parseFloat(meta.regularMarketDayHigh);
    const low = parseFloat(meta.regularMarketDayLow);

    let timeLabel = "";
    if (meta.regularMarketTime) {
        const d = new Date(meta.regularMarketTime * 1000);
        timeLabel = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    return { price, prevClose, high, low, timeLabel };
}

async function fetchFromYahooViaProxy(proxyType) {
    const yfTarget = `https://query2.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=2d&_=${Date.now()}`;
    let url = "";
    if (proxyType === "allorigins") {
        url = `https://api.allorigins.win/get?url=${encodeURIComponent(yfTarget)}`;
    } else if (proxyType === "corsproxy") {
        url = `https://corsproxy.io/?${encodeURIComponent(yfTarget)}`;
    } else {
        url = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(yfTarget)}`;
    }

    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) throw new Error(`Proxy ${proxyType} HTTP error`);
    const raw = await res.json();
    const yfJson = proxyType === "allorigins" ? JSON.parse(raw.contents) : raw;
    const parsed = parseYahooData(yfJson);
    if (!parsed) throw new Error(`Proxy ${proxyType} parse failed`);
    return parsed;
}

export async function fetchTaiwanStockIndex(isManual = false, notifyCallback = null) {
    const taiexEl = document.getElementById("taiexMainInfo");
    const refreshIcon = document.getElementById("taiexRefreshIcon");

    if (isManual && refreshIcon) {
        refreshIcon.classList.add("fa-spin");
    }

    // 先讀取本地快取避免畫面空白
    const cachedRaw = localStorage.getItem(TAIEX_CACHE_KEY);
    let hasRenderedCache = false;
    if (cachedRaw && !isManual) {
        try {
            const c = JSON.parse(cachedRaw);
            hasRenderedCache = renderTaiexDisplay({ ...c, timeLabel: `${c.timeLabel} 快取` });
        } catch (e) { /* ignore */ }
    }

    try {
        // 同時發出所有資料來源請求，取最先成功回傳的結果
        const tasks = [
            fetchFromJsonpEastMoney(),
            fetchFromFinMindDirect(),
            fetchFromTwseDirect(),
            fetchFromYahooViaProxy("allorigins"),
            fetchFromYahooViaProxy("corsproxy"),
            fetchFromYahooViaProxy("codetabs")
        ];
        if (CUSTOM_GAS_TAIEX_URL) {
            tasks.unshift(fetchFromCustomGas());
        }

        const winnerQuote = await Promise.any(tasks);

        if (renderTaiexDisplay(winnerQuote)) {
            localStorage.setItem(TAIEX_CACHE_KEY, JSON.stringify(winnerQuote));
            if (isManual && notifyCallback) notifyCallback("已更新台股加權指數最新報價");
        }
    } catch (err) {
        console.error("All TAIEX sources failed:", err);
        if (!hasRenderedCache && taiexEl) {
            taiexEl.innerHTML = `<span class="text-slate-300 text-xs">暫無法取得大盤報價（請稍後點擊右側重整）</span>`;
        } else if (isManual && notifyCallback) {
            notifyCallback("目前連線受限，顯示最近一次大盤報價");
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove("fa-spin");
    }
}