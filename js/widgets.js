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
        const res = await fetch(url);
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

export async function fetchTaiwanStockIndex(isManual = false, notifyCallback = null) {
    const taiexEl = document.getElementById("taiexMainInfo");
    const refreshIcon = document.getElementById("taiexRefreshIcon");

    if (isManual && refreshIcon) {
        refreshIcon.classList.add("fa-spin");
    }

    try {
        const twseUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0&_=${Date.now()}`;
        const proxyUrl1 = `https://api.allorigins.win/get?url=${encodeURIComponent(twseUrl)}`;

        const res1 = await fetch(proxyUrl1);
        if (res1.ok) {
            const wrapper = await res1.json();
            const parsed = JSON.parse(wrapper.contents);
            if (parsed && parsed.msgArray && parsed.msgArray.length > 0) {
                const info = parsed.msgArray[0];
                let current = parseFloat(info.z);
                const prevClose = parseFloat(info.y);
                const high = parseFloat(info.h);
                const low = parseFloat(info.l);
                const timeStr = info.t ? info.t.slice(0, 5) : "";

                if (isNaN(current) || current <= 0) {
                    current = parseFloat(info.o) || prevClose;
                }

                if (renderTaiexDisplay(current, prevClose, high, low, timeStr)) {
                    if (isManual && notifyCallback) notifyCallback("已更新台股加權指數最新報價");
                    return;
                }
            }
        }
        throw new Error("TWSE MIS fallback to Yahoo Finance");
    } catch (err1) {
        try {
            const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=2d`;
            const proxyUrl2 = `https://api.allorigins.win/get?url=${encodeURIComponent(yfUrl)}`;
            const res2 = await fetch(proxyUrl2);
            if (res2.ok) {
                const wrapper2 = await res2.json();
                const yfData = JSON.parse(wrapper2.contents);
                const meta = yfData?.chart?.result?.[0]?.meta;
                if (meta && meta.regularMarketPrice) {
                    const price = parseFloat(meta.regularMarketPrice);
                    const prevClose = parseFloat(meta.chartPreviousClose || meta.previousClose);
                    const high = parseFloat(meta.regularMarketDayHigh);
                    const low = parseFloat(meta.regularMarketDayLow);
                    if (renderTaiexDisplay(price, prevClose, high, low, "Yahoo報價")) {
                        if (isManual && notifyCallback) notifyCallback("已更新台股加權指數最新報價");
                        return;
                    }
                }
            }
            throw new Error("All stock sources failed");
        } catch (err2) {
            console.error("TAIEX fetch failed:", err1, err2);
            if (taiexEl) {
                taiexEl.innerHTML = `<span class="text-slate-300 text-xs">暫無法取得大盤即時報價</span>`;
            }
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove("fa-spin");
    }
}