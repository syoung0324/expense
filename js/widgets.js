// ==========================================
// 共用工具：帶逾時控制的 fetch
// ==========================================
async function fetchWithTimeout(url, timeoutMs = 5000) {
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
// 2. 今日台灣股票大盤指數 (加權指數 TAIEX)
// ==========================================
const TAIEX_CACHE_KEY = "taiex_last_quote_cache";

function renderTaiexDisplay(price, prevClose, high, low, timeLabel) {
    const taiexEl = document.getElementById("taiexMainInfo");
    if (!taiexEl || isNaN(price) || price <= 0) return false;

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

function parseYahooTaiexJson(yfData) {
    const meta = yfData?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;

    const price = parseFloat(meta.regularMarketPrice);
    const prevClose = parseFloat(meta.chartPreviousClose || meta.previousClose);
    const high = parseFloat(meta.regularMarketDayHigh);
    const low = parseFloat(meta.regularMarketDayLow);

    let timeLabel = "";
    if (meta.regularMarketTime) {
        const d = new Date(meta.regularMarketTime * 1000);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        timeLabel = `${hh}:${mm}`;
    }

    return { price, prevClose, high, low, timeLabel };
}

export async function fetchTaiwanStockIndex(isManual = false, notifyCallback = null) {
    const taiexEl = document.getElementById("taiexMainInfo");
    const refreshIcon = document.getElementById("taiexRefreshIcon");

    if (isManual && refreshIcon) {
        refreshIcon.classList.add("fa-spin");
    }

    // 先讀取本地快取避免空白等待
    const cachedRaw = localStorage.getItem(TAIEX_CACHE_KEY);
    let hasRenderedCache = false;
    if (cachedRaw && !isManual) {
        try {
            const c = JSON.parse(cachedRaw);
            hasRenderedCache = renderTaiexDisplay(c.price, c.prevClose, c.high, c.low, `${c.timeLabel} 快取`);
        } catch (e) { /* ignore */ }
    }

    const yfTarget = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1m&range=1d&_=${Date.now()}`;

    // 多組 CORS 代理線路依序嘗試（每條限制 5 秒逾時）
    const proxyGenerators = [
        () => `https://corsproxy.io/?${encodeURIComponent(yfTarget)}`,
        () => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(yfTarget)}`,
        () => `https://api.allorigins.win/raw?url=${encodeURIComponent(yfTarget)}`
    ];

    try {
        for (const makeUrl of proxyGenerators) {
            try {
                const res = await fetchWithTimeout(makeUrl(), 5000);
                if (!res.ok) continue;
                const json = await res.json();
                const parsed = parseYahooTaiexJson(json);

                if (parsed && renderTaiexDisplay(parsed.price, parsed.prevClose, parsed.high, parsed.low, parsed.timeLabel)) {
                    localStorage.setItem(TAIEX_CACHE_KEY, JSON.stringify(parsed));
                    if (isManual && notifyCallback) notifyCallback("已更新台股加權指數最新報價");
                    return;
                }
            } catch (err) {
                // 單一代理失敗或逾時，自動切換下一組代理
                continue;
            }
        }

        // 備援路線：證交所 OpenAPI 每日大盤指數 (FMTQIK)
        const twseOpenUrl = "https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK";
        const twseRes = await fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(twseOpenUrl)}`, 5000);
        if (twseRes.ok) {
            const rows = await twseRes.json();
            if (Array.isArray(rows) && rows.length > 0) {
                const latest = rows[rows.length - 1];
                const price = parseFloat(String(latest.TAIEX).replace(/,/g, ""));
                const change = parseFloat(String(latest.Change).replace(/,/g, ""));
                const prevClose = !isNaN(price) && !isNaN(change) ? price - change : price;
                const dateLabel = latest.Date ? `證交所 ${latest.Date}` : "證交所收盤";

                if (renderTaiexDisplay(price, prevClose, null, null, dateLabel)) {
                    localStorage.setItem(TAIEX_CACHE_KEY, JSON.stringify({
                        price, prevClose, high: null, low: null, timeLabel: dateLabel
                    }));
                    if (isManual && notifyCallback) notifyCallback("已更新台股大盤收盤指數");
                    return;
                }
            }
        }

        throw new Error("All stock API routes failed");
    } catch (err) {
        console.error("TAIEX fetch failed:", err);
        if (!hasRenderedCache && taiexEl) {
            taiexEl.innerHTML = `<span class="text-slate-300 text-xs">暫無法取得大盤報價（請稍後點擊右側重整）</span>`;
        } else if (isManual && notifyCallback) {
            notifyCallback("目前連線逾時，顯示最近一次大盤報價");
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove("fa-spin");
    }
}
