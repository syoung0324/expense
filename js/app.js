import { setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dataDocRef, adminDocRef, DEFAULT_MONTH_KEY, INITIAL_COLUMNS, INITIAL_MEMBERS } from "./firebase-config.js";
import { fetchXinfengWeather, fetchTaiwanStockIndex } from "./widgets.js";

let monthsData = {};
let currentMonth = DEFAULT_MONTH_KEY;
let columns = [];
let members = [];
let searchQuery = "";
let viewMode = "table";
let copiedAmount = null;
let pendingWorkbook = null;
let pendingImportData = null;
let isAdminLoggedIn = false;
let draggedMonthKey = null;

// 判斷指定月份是否啟用「姜宸媽對帳區」（預設為 true，維持既有分頁相容性）
function isReconcileEnabled(mKey = currentMonth) {
    const m = monthsData[mKey];
    if (!m) return true;
    return m.enableReconcile !== false;
}

function updateSyncStatus(text, iconClass) {
    const statusEl = document.getElementById("syncStatusText");
    const iconEl = document.getElementById("syncStatusIcon");
    if (statusEl) statusEl.innerText = text;
    if (iconEl) iconEl.className = iconClass;
}

function initApp() {
    fetchXinfengWeather(false, showToast);
    fetchTaiwanStockIndex(false, showToast);

    if (localStorage.getItem("team_expense_is_admin") === "true") {
        isAdminLoggedIn = true;
    }
    updateAdminUI();

    const savedMonths = localStorage.getItem("team_expense_months_data");
    const savedCurrentMonth = localStorage.getItem("team_expense_current_month");

    if (savedMonths) {
        try {
            monthsData = JSON.parse(savedMonths);
        } catch (e) {
            monthsData = {};
        }
    }

    if (Object.keys(monthsData).length === 0) {
        monthsData[DEFAULT_MONTH_KEY] = {
            columns: JSON.parse(JSON.stringify(INITIAL_COLUMNS)),
            members: JSON.parse(JSON.stringify(INITIAL_MEMBERS)),
            enableReconcile: true
        };
    }

    if (savedCurrentMonth && monthsData[savedCurrentMonth]) {
        currentMonth = savedCurrentMonth;
    } else {
        currentMonth = Object.keys(monthsData)[0];
    }

    if (!isAdminLoggedIn && monthsData[currentMonth] && monthsData[currentMonth].isHidden) {
        const firstVisible = Object.keys(monthsData).find(k => !monthsData[k].isHidden);
        if (firstVisible) {
            currentMonth = firstVisible;
        }
    }

    loadMonthData(currentMonth, false);
    setupFirestoreListener();
}

function handleAdminBtnClick() {
    if (!isAdminLoggedIn) {
        openAdminModal();
    }
}

function logoutAdmin() {
    if (!isAdminLoggedIn) return;
    if (confirm("確定要登出管理者身分嗎？")) {
        isAdminLoggedIn = false;
        localStorage.removeItem("team_expense_is_admin");
        updateAdminUI();
        showToast("已登出管理者身分");
    }
}

function openAdminModal() {
    document.getElementById("adminPasswordInput").value = "";
    document.getElementById("adminModal").classList.remove("hidden");
    document.getElementById("adminPasswordInput").focus();
}

function closeAdminModal() {
    document.getElementById("adminModal").classList.add("hidden");
}

async function checkAdminPassword() {
    const inputPwd = document.getElementById("adminPasswordInput").value.trim();
    if (!inputPwd) {
        alert("請輸入密碼！");
        return;
    }

    try {
        updateSyncStatus("驗證密碼中...", "fa-solid fa-rotate text-amber-300 animate-spin text-xs");
        let docSnap = await getDoc(adminDocRef);

        if (!docSnap.exists() || !docSnap.data().password) {
            alert("系統尚未於雲端設定管理者密碼，請聯繫管理員至 Firebase 後台設定！");
            updateSyncStatus("請先設定密碼", "fa-solid fa-triangle-exclamation text-amber-400 text-xs");
            return;
        }

        const storedPassword = docSnap.data().password;

        if (inputPwd === storedPassword) {
            isAdminLoggedIn = true;
            localStorage.setItem("team_expense_is_admin", "true");
            updateAdminUI();
            closeAdminModal();
            showToast("🦩 管理者登入成功！");
        } else {
            alert("密碼錯誤，請重新輸入！");
        }
        updateSyncStatus("已即時同步至雲端", "fa-solid fa-cloud-check text-emerald-400 text-xs");
    } catch (e) {
        console.error("Firestore 驗證錯誤:", e);
        alert("連線至雲端資料庫驗證密碼時發生錯誤，請檢查網路連線！");
    }
}

function updateAdminUI() {
    const btnText = document.getElementById("adminBtnText");
    const btn = document.getElementById("btnAdminLogin");
    
    const adminOnlyElements = [
        document.getElementById("btnAdminLogout"),
        document.getElementById("btnAddMonthBtn"),
        document.getElementById("btnAddMemberBtn"),
        document.getElementById("btnAddColumnBtn"),
        document.getElementById("wrapImportExcel"),
        document.getElementById("wrapExportExcel"),
        document.getElementById("btnBatchPaste")
    ];

    if (isAdminLoggedIn) {
        btnText.innerText = "管理者 (已登入)";
        btn.className = "bg-emerald-700 text-white font-medium text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg shadow flex items-center gap-1.5 border border-emerald-400/40 cursor-default";
        adminOnlyElements.forEach(el => el && el.classList.remove("hidden"));
    } else {
        btnText.innerText = "管理者登入";
        btn.className = "bg-indigo-800 hover:bg-indigo-600 text-white font-medium text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg shadow transition flex items-center gap-1.5 border border-indigo-400/40 cursor-pointer";
        adminOnlyElements.forEach(el => el && el.classList.add("hidden"));
        
        if (monthsData[currentMonth] && monthsData[currentMonth].isHidden) {
            const firstVisible = Object.keys(monthsData).find(k => !monthsData[k].isHidden);
            if (firstVisible) {
                currentMonth = firstVisible;
                localStorage.setItem("team_expense_current_month", currentMonth);
                columns = monthsData[currentMonth].columns || [];
                members = monthsData[currentMonth].members || [];
            } else {
                columns = [];
                members = [];
            }
        }
    }

    renderMonthTabs();
    renderTable();
    renderCards();
}

function setupFirestoreListener() {
    updateSyncStatus("從雲端載入名單中...", "fa-solid fa-rotate text-amber-300 animate-spin text-xs");

    onSnapshot(dataDocRef, (docSnap) => {
        if (docSnap.metadata.hasPendingWrites) {
            updateSyncStatus("已即時同步至雲端", "fa-solid fa-cloud-check text-emerald-400 text-xs");
            return;
        }

        if (docSnap.exists()) {
            const cloudData = docSnap.data();
            if (cloudData && cloudData.monthsData) {
                if (cloudData.monthOrder && Array.isArray(cloudData.monthOrder)) {
                    let reorderedMonthsData = {};
                    cloudData.monthOrder.forEach(key => {
                        if (cloudData.monthsData[key]) {
                            reorderedMonthsData[key] = cloudData.monthsData[key];
                        }
                    });
                    Object.keys(cloudData.monthsData).forEach(key => {
                        if (!reorderedMonthsData[key]) {
                            reorderedMonthsData[key] = cloudData.monthsData[key];
                        }
                    });
                    monthsData = reorderedMonthsData;
                } else {
                    monthsData = cloudData.monthsData;
                }

                const savedCurrentMonth = localStorage.getItem("team_expense_current_month");
                if (savedCurrentMonth && monthsData[savedCurrentMonth]) {
                    currentMonth = savedCurrentMonth;
                } else if (!monthsData[currentMonth]) {
                    currentMonth = Object.keys(monthsData)[0] || DEFAULT_MONTH_KEY;
                }

                if (!isAdminLoggedIn && monthsData[currentMonth] && monthsData[currentMonth].isHidden) {
                    const firstVisible = Object.keys(monthsData).find(k => !monthsData[k].isHidden);
                    if (firstVisible) {
                        currentMonth = firstVisible;
                    }
                }

                loadMonthData(currentMonth, false);
            }
            updateSyncStatus("已即時同步至雲端", "fa-solid fa-cloud-check text-emerald-400 text-xs");
        } else {
            updateSyncStatus("雲端尚無資料 (請登入建立)", "fa-solid fa-cloud text-amber-300 text-xs");
        }
    }, (error) => {
        console.error("Firestore 同步失敗:", error);
        updateSyncStatus("雲端連線失敗 (離線模式)", "fa-solid fa-cloud-slash text-rose-400 text-xs");
    });
}

function loadMonthData(monthKey, shouldSave = true) {
    if (!isAdminLoggedIn && monthsData[monthKey] && monthsData[monthKey].isHidden) {
        const firstVisible = Object.keys(monthsData).find(k => !monthsData[k].isHidden);
        if (firstVisible) {
            monthKey = firstVisible;
        } else {
            alert("目前沒有公開的月份資料可供檢視。");
            return;
        }
    }

    currentMonth = monthKey;
    localStorage.setItem("team_expense_current_month", currentMonth);
   
    if (!monthsData[currentMonth]) {
        monthsData[currentMonth] = {
            columns: JSON.parse(JSON.stringify(columns.length > 0 ? columns : INITIAL_COLUMNS)),
            members: [],
            enableReconcile: true
        };
    }

    columns = monthsData[currentMonth].columns;
    members = monthsData[currentMonth].members;

    renderMonthTabs();
    renderTable();
    renderCards();

    if (shouldSave) {
        saveState();
    }
}

async function saveState() {
    if (currentMonth && monthsData[currentMonth]) {
        monthsData[currentMonth].columns = columns;
        monthsData[currentMonth].members = members;
    }
    localStorage.setItem("team_expense_months_data", JSON.stringify(monthsData));
    localStorage.setItem("team_expense_current_month", currentMonth);

    try {
        updateSyncStatus("儲存中...", "fa-solid fa-rotate text-amber-300 animate-spin text-xs");
        await setDoc(dataDocRef, { 
            monthsData,
            monthOrder: Object.keys(monthsData),
            updatedAt: new Date().toISOString() 
        });
        updateSyncStatus("已即時同步至雲端", "fa-solid fa-cloud-check text-emerald-400 text-xs");
    } catch (e) {
        console.error("Save to Firestore Error:", e);
        updateSyncStatus("儲存失敗 (暫存本地)", "fa-solid fa-triangle-exclamation text-amber-400 text-xs");
    }
}

// ==========================================
// 月份頁籤拖拽與管理
// ==========================================
function handleMonthDragStart(e, mKey) {
    if (!isAdminLoggedIn) return;
    draggedMonthKey = mKey;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", mKey);
    e.currentTarget.classList.add("opacity-40", "scale-95");
}

function handleMonthDragOver(e) {
    if (!isAdminLoggedIn) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
}

function handleMonthDragEnter(e) {
    if (!isAdminLoggedIn) return;
    e.preventDefault();
    e.currentTarget.classList.add("border-indigo-500", "ring-2", "ring-indigo-400", "bg-indigo-50");
}

function handleMonthDragLeave(e) {
    if (!isAdminLoggedIn) return;
    e.currentTarget.classList.remove("border-indigo-500", "ring-2", "ring-indigo-400", "bg-indigo-50");
}

function handleMonthDrop(e, targetKey) {
    if (!isAdminLoggedIn) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove("border-indigo-500", "ring-2", "ring-indigo-400", "bg-indigo-50");

    if (!draggedMonthKey || draggedMonthKey === targetKey) return;

    const keys = Object.keys(monthsData);
    const dragIdx = keys.indexOf(draggedMonthKey);
    const targetIdx = keys.indexOf(targetKey);

    if (dragIdx > -1 && targetIdx > -1) {
        keys.splice(dragIdx, 1);
        keys.splice(targetIdx, 0, draggedMonthKey);

        const reorderedMonthsData = {};
        keys.forEach(k => {
            reorderedMonthsData[k] = monthsData[k];
        });
        monthsData = reorderedMonthsData;

        saveState();
        renderMonthTabs();
        showToast(`已成功重新排序月份標籤！`);
    }
}

function handleMonthDragEnd(e) {
    if (!isAdminLoggedIn) return;
    e.currentTarget.classList.remove("opacity-40", "scale-95");
    draggedMonthKey = null;
}

function renderMonthTabs() {
    const container = document.getElementById("monthTabsContainer");
    let html = "";
    Object.keys(monthsData).forEach(mKey => {
        const monthInfo = monthsData[mKey];
        const isHidden = !!monthInfo.isHidden;
        const hasReconcile = isReconcileEnabled(mKey);

        if (!isAdminLoggedIn && isHidden) return;

        const isActive = mKey === currentMonth;
        
        html += `
            <div ${isAdminLoggedIn ? `draggable="true" ondragstart="handleMonthDragStart(event, '${mKey}')" ondragover="handleMonthDragOver(event)" ondragenter="handleMonthDragEnter(event)" ondragleave="handleMonthDragLeave(event)" ondrop="handleMonthDrop(event, '${mKey}')" ondragend="handleMonthDragEnd(event)" class="cursor-grab active:cursor-grabbing hover:border-slate-300"` : ''}
                 class="flex flex-col items-start group ${isHidden ? 'bg-slate-200/60 border-slate-300/60' : 'bg-slate-100/80 border-slate-200/50'} rounded-lg p-1 border transition-all select-none shrink-0">
                <button onclick="loadMonthData('${mKey}')" class="px-2.5 sm:px-3 py-1.5 rounded-lg font-medium text-xs sm:text-sm whitespace-nowrap transition flex items-center gap-1 sm:gap-1.5 ${isActive ? (isHidden ? 'bg-slate-700 text-slate-200 shadow-sm font-semibold' : 'bg-indigo-600 text-white shadow-sm font-semibold') : (isHidden ? 'text-slate-500 hover:bg-slate-300' : 'text-slate-600 hover:bg-slate-200')}">
                    ${isHidden ? '<i class="fa-solid fa-eye-slash text-xs"></i>' : '<i class="fa-regular fa-calendar-check text-xs"></i>'}
                    <span class="${isHidden ? 'line-through decoration-current opacity-80' : ''}">${mKey}</span>
                </button>
                ${isAdminLoggedIn ? `
                    <div class="flex items-center gap-1 px-1.5 pt-1 pb-0.5 w-full">
                        <button onclick="toggleMonthVisibility('${mKey}')" class="text-slate-400 hover:text-amber-600 px-1 transition opacity-75 hover:opacity-100" title="${isHidden ? '目前為隱藏狀態，點擊設為公開' : '目前為公開狀態，點擊設為隱藏'}">
                            <i class="fa-solid ${isHidden ? 'fa-eye' : 'fa-eye-slash'} text-[11px]"></i>
                        </button>
                        <button onclick="openEditMonthModal('${mKey}')" class="text-slate-400 hover:text-indigo-600 px-1 transition opacity-75 hover:opacity-100" title="修改月份名稱">
                            <i class="fa-solid fa-pen text-[11px]"></i>
                        </button>
                        <button onclick="toggleMonthReconcile('${mKey}')" class="px-1 py-0.2 rounded transition flex items-center gap-0.5 ${hasReconcile ? 'bg-rose-100 text-rose-700 border border-rose-300/80 opacity-100 shadow-2xs' : 'text-slate-400 opacity-45 grayscale hover:opacity-80'}" title="${hasReconcile ? '已開啟【姜宸媽對帳區】，點擊關閉' : '未開啟【姜宸媽對帳區】，點擊開啟'}">
                            <span class="text-xs leading-none">🤺</span>
                        </button>
                        ${Object.keys(monthsData).length > 1 ? `
                            <button onclick="deleteMonth('${mKey}')" class="text-slate-400 hover:text-rose-500 px-1 transition opacity-75 hover:opacity-100 ml-auto" title="刪除此月份">
                                <i class="fa-solid fa-xmark text-xs"></i>
                            </button>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    if (!isAdminLoggedIn && html === "") {
        html = `<div class="text-xs text-slate-400 px-2 py-1">目前沒有公開的月份資料</div>`;
    }
    
    container.innerHTML = html;
}

function toggleMonthReconcile(mKey) {
    if (!isAdminLoggedIn || !monthsData[mKey]) return;
    const currentStatus = isReconcileEnabled(mKey);
    monthsData[mKey].enableReconcile = !currentStatus;
    saveState();
    renderMonthTabs();
    if (mKey === currentMonth) {
        renderTable();
        renderCards();
    }
    showToast(`已將「${mKey}」的姜宸媽對帳區${!currentStatus ? '開啟' : '關閉'}`);
}

function toggleMonthVisibility(mKey) {
    if (!isAdminLoggedIn || !monthsData[mKey]) return;
    monthsData[mKey].isHidden = !monthsData[mKey].isHidden;
    saveState();
    renderMonthTabs();
    showToast(`已將「${mKey}」設為${monthsData[mKey].isHidden ? '隱藏 (僅管理者可見)' : '公開'}`);
}

function openEditMonthModal(mKey) {
    if (!isAdminLoggedIn) return;
    document.getElementById("oldMonthNameInput").value = mKey;
    document.getElementById("newMonthNameInput").value = mKey;
    document.getElementById("editMonthModal").classList.remove("hidden");
    document.getElementById("newMonthNameInput").focus();
}

function closeEditMonthModal() {
    document.getElementById("editMonthModal").classList.add("hidden");
}

function saveEditedMonthName() {
    if (!isAdminLoggedIn) return;
    const oldKey = document.getElementById("oldMonthNameInput").value;
    const newKey = document.getElementById("newMonthNameInput").value.trim();

    if (!newKey) {
        alert("請輸入月份名稱！");
        return;
    }

    if (newKey !== oldKey && monthsData[newKey]) {
        alert("該月份名稱已存在！");
        return;
    }

    if (newKey !== oldKey) {
        monthsData[newKey] = monthsData[oldKey];
        delete monthsData[oldKey];

        if (currentMonth === oldKey) {
            currentMonth = newKey;
        }
        saveState();
        renderMonthTabs();
        showToast(`已成功將「${oldKey}」更名為「${newKey}」`);
    }
    closeEditMonthModal();
}

function openAddMonthModal() {
    if (!isAdminLoggedIn) return;
    document.getElementById("monthNameInput").value = "";
    
    const container = document.getElementById("monthColumnCheckboxes");
    let html = "";
    if (columns.length === 0) {
        html = `<p class="text-xs text-slate-400 py-2">當前月份無任何費用項目</p>`;
    } else {
        columns.forEach(col => {
            html += `
                <label class="flex items-center justify-between p-2 hover:bg-white rounded border border-slate-200/60 cursor-pointer text-xs bg-white/50 transition">
                    <span class="font-medium text-slate-700 truncate pr-2">${col.title}</span>
                    <input type="checkbox" name="copyColumnCheck" value="${col.id}" checked class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 shrink-0">
                </label>
            `;
        });
    }
    container.innerHTML = html;

    document.getElementById("monthModal").classList.remove("hidden");
    document.getElementById("monthNameInput").focus();
}

function closeMonthModal() {
    document.getElementById("monthModal").classList.add("hidden");
}

function toggleSelectAllMonthCols() {
    const checkboxes = document.querySelectorAll('input[name="copyColumnCheck"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
}

function saveNewMonth() {
    if (!isAdminLoggedIn) return;
    const monthName = document.getElementById("monthNameInput").value.trim();
    const copyRoster = document.getElementById("copyRosterCheck").checked;

    if (!monthName) {
        alert("請輸入月份名稱！");
        return;
    }
    if (monthsData[monthName]) {
        alert("該月份名稱已存在！");
        return;
    }

    const selectedColIds = Array.from(document.querySelectorAll('input[name="copyColumnCheck"]:checked')).map(el => el.value);
    const copiedColumns = columns.filter(c => selectedColIds.includes(c.id));

    let newMembers = [];
    if (copyRoster && members.length > 0) {
        newMembers = members.map(m => ({
            id: "m_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
            name: m.name,
            values: {}
        }));
    }

    monthsData[monthName] = {
        columns: JSON.parse(JSON.stringify(copiedColumns)),
        members: newMembers,
        enableReconcile: true
    };

    closeMonthModal();
    loadMonthData(monthName);
    showToast(`已成功新增並切換至「${monthName}」（包含 ${copiedColumns.length} 個費用項目）`);
}

function deleteMonth(mKey) {
    if (!isAdminLoggedIn) return;
    if (Object.keys(monthsData).length <= 1) {
        alert("至少需要保留一個月份！");
        return;
    }
    if (confirm(`確定要刪除「${mKey}」整個月份的數據嗎？此動作無法撤銷。`)) {
        delete monthsData[mKey];
        if (currentMonth === mKey) {
            currentMonth = Object.keys(monthsData)[0];
        }
        saveState();
        loadMonthData(currentMonth, false);
        showToast(`已成功刪除「${mKey}」！`);
    }
}

// ==========================================
// 檢視切換、金額複製與批次貼上
// ==========================================
function switchViewMode(mode) {
    viewMode = mode;
    const tableContainer = document.getElementById("tableViewContainer");
    const cardsContainer = document.getElementById("cardsViewContainer");
    const btnViewTable = document.getElementById("btnViewTable");
    const btnViewCards = document.getElementById("btnViewCards");

    if (mode === 'cards') {
        tableContainer.classList.add("hidden");
        cardsContainer.classList.remove("hidden");
        btnViewCards.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md bg-white text-indigo-700 shadow-sm transition";
        btnViewTable.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md text-slate-600 hover:text-indigo-600 transition";
        renderCards();
    } else {
        cardsContainer.classList.add("hidden");
        tableContainer.classList.remove("hidden");
        btnViewTable.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md bg-white text-indigo-700 shadow-sm transition";
        btnViewCards.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md text-slate-600 hover:text-indigo-600 transition";
        renderTable();
    }
}

function copyAmount(val, colId) {
    copiedAmount = val;
    document.getElementById("copiedAmountText").innerText = val.toLocaleString();
    document.getElementById("copiedBadge").classList.remove("hidden");
    showToast(`已複製金額: NT$ ${val.toLocaleString()}`);
}

function clearCopiedAmount() {
    copiedAmount = null;
    document.getElementById("copiedBadge").classList.add("hidden");
    showToast("已清除複製金額");
}

function openBatchPasteModal() {
    if (!isAdminLoggedIn) {
        alert("需有管理者權限才能批次貼上修改金額！");
        return;
    }
    if (copiedAmount === null) {
        alert("請先複製金額！");
        return;
    }
    document.getElementById("batchPasteAmountLabel").innerText = copiedAmount.toLocaleString();
   
    const colSelect = document.getElementById("batchTargetColumnSelect");
    colSelect.innerHTML = columns.map(c => `<option value="${c.id}">${c.title}</option>`).join("");

    const memberListDiv = document.getElementById("batchMemberList");
    memberListDiv.innerHTML = members.map(m => `
        <label class="flex items-center justify-between p-1.5 hover:bg-slate-50 rounded cursor-pointer text-xs">
            <span class="font-medium text-slate-700">${m.name}</span>
            <input type="checkbox" name="batchMemberCheckbox" value="${m.id}" checked class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500">
        </label>
    `).join("");

    document.getElementById("batchPasteModal").classList.remove("hidden");
}

function closeBatchPasteModal() {
    document.getElementById("batchPasteModal").classList.add("hidden");
}

function toggleSelectAllBatchMembers() {
    const checkboxes = document.querySelectorAll('input[name="batchMemberCheckbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
}

function applyBatchPaste() {
    if (!isAdminLoggedIn) return;
    const targetColId = document.getElementById("batchTargetColumnSelect").value;
    if (!targetColId) {
        alert("請選擇目標項目欄位！");
        return;
    }

    const checkboxes = document.querySelectorAll('input[name="batchMemberCheckbox"]:checked');
    if (checkboxes.length === 0) {
        alert("請至少選擇一位隊員！");
        return;
    }

    let count = 0;
    checkboxes.forEach(cb => {
        const member = members.find(m => m.id === cb.value);
        if (member) {
            member.values[targetColId] = copiedAmount;
            count++;
        }
    });

    saveState();
    renderTable();
    renderCards();
    closeBatchPasteModal();
    showToast(`已成功將 NT$ ${copiedAmount.toLocaleString()} 批次填入 ${count} 位隊員！`);
}

// ==========================================
// 表格與卡片渲染邏輯
// ==========================================
function renderTable() {
    const headerRow = document.getElementById("tableHeaderRow");
    const tbody = document.getElementById("tableBody");
    const tfoot = document.getElementById("tableFooter");
    const showReconcile = isReconcileEnabled();

    const filteredMembers = members.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()));

    let headerHTML = `
        <th class="p-2 sm:p-3 w-10 sm:w-12 text-center sticky-col-1 bg-slate-100 border-r border-slate-200 text-xs">#</th>
        <th class="p-2 sm:p-3 w-28 sm:w-36 sticky-col-2 bg-slate-100 border-r border-slate-200 shadow-sm text-xs sm:text-sm">姓名</th>
    `;
    columns.forEach(col => {
        const hasNote = col.note && col.note.trim() !== "";
        headerHTML += `
            <th class="py-2 sm:py-2.5 px-2 text-center whitespace-nowrap border-r border-slate-200 group relative">
                <div class="flex items-center justify-center gap-1">
                    <div class="flex items-center gap-1 truncate cursor-pointer" onclick="openNoteModal('${col.id}')" title="點擊查看項目說明與編輯">
                        <span class="truncate font-semibold text-slate-800 hover:text-indigo-600 transition text-xs sm:text-sm">${col.title}</span>
                        ${hasNote ? `<button onclick="event.stopPropagation(); openNoteModal('${col.id}')" class="text-amber-500 hover:text-amber-600 text-xs" title="查看備註說明"><i class="fa-solid fa-circle-info"></i></button>` : ''}
                    </div>
                    ${isAdminLoggedIn ? `
                        <div class="flex items-center opacity-0 group-hover:opacity-100 transition">
                            <button onclick="openEditColumnModal('${col.id}')" class="text-slate-400 hover:text-indigo-600 px-0.5" title="編輯項目標題與備註">
                                <i class="fa-solid fa-pen text-[10px] sm:text-xs"></i>
                            </button>
                            <button onclick="deleteColumn('${col.id}')" class="text-slate-400 hover:text-rose-500 px-0.5" title="刪除此項目欄位">
                                <i class="fa-solid fa-xmark text-xs"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>
            </th>
        `;
    });

    if (showReconcile) {
        headerHTML += `
            <th class="py-2 sm:py-2.5 px-2 sm:px-3 text-center whitespace-nowrap bg-rose-50 text-rose-800 font-bold border-r border-rose-200 text-xs sm:text-sm">
                <div class="flex items-center justify-center gap-1">
                    <span class="text-base leading-none">🤺</span>
                    <span>【姜宸媽追殺區】</span>
                </div>
            </th>
        `;
    }

    headerHTML += `
        <th class="py-2 sm:py-2.5 px-2 sm:px-3 w-24 sm:w-28 text-right sticky-right bg-slate-100 border-l border-slate-200 text-indigo-700 font-bold shadow-sm whitespace-nowrap text-xs sm:text-sm">應繳金額</th>
        <th class="py-2 sm:py-2.5 px-1 sm:px-2 w-10 sm:w-12 text-center whitespace-nowrap text-xs">操作</th>
    `;
    headerRow.innerHTML = headerHTML;

    let bodyHTML = "";
    let grandTotalSum = 0;
    const columnTotals = {};
    columns.forEach(c => columnTotals[c.id] = 0);

    filteredMembers.forEach((member, index) => {
        let memberTotal = 0;
        const isCheckedPaid = showReconcile && !!member.isPaid;

        let rowHTML = `
            <tr class="hover:bg-slate-50/80 transition group ${isCheckedPaid ? 'bg-emerald-50/30' : ''}">
                <td class="py-1.5 sm:py-2 px-1 sm:px-2 text-center text-slate-400 sticky-col-1 bg-white group-hover:bg-slate-50 border-r border-slate-200 font-mono text-[11px] sm:text-xs">${index + 1}</td>
                <td class="py-1.5 sm:py-2 px-2 sm:px-3 font-medium text-slate-800 sticky-col-2 bg-white group-hover:bg-slate-50 border-r border-slate-200 shadow-sm whitespace-nowrap">
                    <div class="flex items-center justify-between gap-1">
                        <div class="flex items-center gap-1 sm:gap-1.5 truncate">
                            ${showReconcile ? (isCheckedPaid ? `<i class="fa-solid fa-circle-check text-emerald-500 text-xs sm:text-sm" title="對帳完成"></i>` : `<i class="fa-regular fa-circle text-slate-300 text-[10px] sm:text-xs"></i>`) : ''}
                            <span class="truncate text-xs sm:text-sm ${isAdminLoggedIn ? 'cursor-pointer hover:text-indigo-600' : ''} transition ${isCheckedPaid ? 'font-semibold text-emerald-900' : ''}" onclick="${isAdminLoggedIn ? `openEditMemberModal('${member.id}')` : ''}">${member.name}</span>
                        </div>
                        ${isAdminLoggedIn ? `
                            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                                <button onclick="openEditMemberModal('${member.id}')" class="text-slate-400 hover:text-indigo-600 px-0.5" title="編輯姓名">
                                    <i class="fa-solid fa-pen text-[10px] sm:text-xs"></i>
                                </button>
                                <button onclick="deleteMember('${member.id}')" class="text-slate-400 hover:text-rose-500 px-0.5" title="刪除此成員">
                                    <i class="fa-solid fa-user-minus text-[10px] sm:text-xs"></i>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </td>
        `;

        columns.forEach(col => {
            const val = member.values[col.id] !== undefined ? member.values[col.id] : "";
            const numVal = parseFloat(val) || 0;
            memberTotal += numVal;
            columnTotals[col.id] += numVal;

            let cellInputHTML = isAdminLoggedIn
                ? `<input type="number" value="${val}" placeholder="0" onchange="updateMemberValue('${member.id}', '${col.id}', this.value)" class="w-16 sm:w-20 px-1 py-0.5 text-right bg-transparent focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 rounded border hover:border-slate-300 border-transparent font-mono text-xs sm:text-sm ${numVal < 0 ? 'text-rose-600 font-semibold' : 'text-slate-700'}">`
                : `<span class="w-16 sm:w-20 inline-block px-1 py-0.5 text-right font-mono text-xs sm:text-sm ${numVal < 0 ? 'text-rose-600 font-semibold' : 'text-slate-700'}">${val !== "" ? val : '0'}</span>`;

            rowHTML += `
                <td class="py-1 px-1 border-r border-slate-100 text-center relative group/cell">
                    <div class="flex items-center justify-center">
                        ${cellInputHTML}
                        ${val !== "" ? `
                            <button onclick="copyAmount(${val}, '${col.id}')" class="opacity-0 group-hover/cell:opacity-100 transition text-slate-400 hover:text-emerald-600 ml-0.5 px-0.5" title="複製此金額">
                                <i class="fa-regular fa-copy text-[10px] sm:text-[11px]"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            `;
        });

        grandTotalSum += memberTotal;

        if (showReconcile) {
            rowHTML += `
                <td class="py-1.5 sm:py-2 px-2 sm:px-3 text-center border-r border-rose-100 bg-rose-50/20">
                    <button type="button"
                        ${isAdminLoggedIn ? `onclick="toggleMemberPaid('${member.id}', ${!isCheckedPaid})"` : ''}
                        class="${isAdminLoggedIn ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}"
                        title="${isAdminLoggedIn ? (isCheckedPaid ? '取消對帳' : '點擊對帳') : (isCheckedPaid ? '對帳完成' : '需管理者權限才能對帳')}">
                        ${isCheckedPaid ? 
                            `<i class="fa-solid fa-square-check text-emerald-500 text-lg sm:text-xl"></i>` : 
                            `<i class="fa-regular fa-square text-slate-300 text-lg sm:text-xl"></i>`
                        }
                    </button>
                </td>
            `;
        }

        rowHTML += `
                <td class="py-1.5 sm:py-2 px-2 sm:px-3 text-right font-bold text-indigo-700 sticky-right bg-white group-hover:bg-slate-50 border-l border-slate-200 font-mono shadow-sm whitespace-nowrap text-xs sm:text-sm">
                    ${memberTotal.toLocaleString()}
                </td>
                <td class="py-1.5 sm:py-2 px-1 text-center">
                    ${isAdminLoggedIn ? `
                        <button onclick="deleteMember('${member.id}')" class="text-slate-300 hover:text-rose-500 transition px-1 py-0.5" title="刪除隊員">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    ` : `<span class="text-slate-300">-</span>`}
                </td>
            </tr>
        `;
        bodyHTML += rowHTML;
    });

    if (filteredMembers.length === 0) {
        const totalCols = columns.length + (showReconcile ? 5 : 4);
        bodyHTML = `
            <tr>
                <td colspan="${totalCols}" class="p-8 text-center text-slate-400">
                    ${members.length === 0 ? '正在從雲端資料庫載入隊員名單，或尚無隊員資料...' : '沒有找到相關的隊員資料'}
                </td>
            </tr>
        `;
    }

    tbody.innerHTML = bodyHTML;

    let footerHTML = `
        <tr>
            <td class="p-2 sm:p-3 sticky-col-1 bg-indigo-50 border-r border-indigo-200"></td>
            <td class="p-2 sm:p-3 sticky-col-2 bg-indigo-50 border-r border-indigo-200 font-bold text-indigo-900 shadow-sm text-xs sm:text-sm">合計 (總數)</td>
    `;

    columns.forEach(col => {
        const colSum = columnTotals[col.id] || 0;
        footerHTML += `
            <td class="p-2 sm:p-3 text-right border-r border-indigo-100 font-mono text-xs sm:text-sm ${colSum < 0 ? 'text-rose-600' : ''}">
                ${colSum.toLocaleString()}
            </td>
        `;
    });

    if (showReconcile) {
        const paidCount = members.filter(m => m.isPaid).length;
        footerHTML += `
            <td class="p-2 sm:p-3 text-center border-r border-rose-200 bg-rose-100/60 font-mono text-[11px] sm:text-xs text-rose-900 font-bold">
                對帳: ${paidCount}/${members.length}
            </td>
        `;
    }

    footerHTML += `
            <td class="p-2 sm:p-3 text-right sticky-right bg-indigo-50 border-l border-indigo-200 text-indigo-950 font-extrabold text-xs sm:text-base font-mono shadow-sm">
                ${grandTotalSum.toLocaleString()}
            </td>
            <td class="p-2 sm:p-3"></td>
        </tr>
    `;
    tfoot.innerHTML = footerHTML;

    document.getElementById("statMemberCount").innerText = members.length;
    document.getElementById("statGrandTotal").innerText = `NT$ ${grandTotalSum.toLocaleString()}`;
}

function updateMemberValue(memberId, colId, value) {
    if (!isAdminLoggedIn) {
        alert("需有管理者權限才能修改金額！");
        renderTable();
        return;
    }
    const member = members.find(m => m.id === memberId);
    if (member) {
        if (value === "" || isNaN(value)) {
            delete member.values[colId];
        } else {
            member.values[colId] = parseFloat(value);
        }
        saveState();
        renderTable();
        renderCards();
    }
}

function toggleMemberPaid(memberId, isChecked) {
    if (!isAdminLoggedIn) {
        alert("需有管理者權限才能進行對帳操作！");
        renderTable();
        renderCards();
        return;
    }
    const member = members.find(m => m.id === memberId);
    if (member) {
        member.isPaid = isChecked;
        saveState();
        renderTable();
        renderCards();
        showToast(`${member.name} 已標示為 ${isChecked ? '【對帳完成】' : '【未對帳】'}`);
    }
}

function renderCards() {
    const container = document.getElementById("cardsViewContainer");
    const filteredMembers = members.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()));
    const showReconcile = isReconcileEnabled();

    if (filteredMembers.length === 0) {
        container.innerHTML = `<div class="col-span-full p-8 text-center bg-white rounded-xl border text-slate-400">${members.length === 0 ? '正在從雲端資料庫載入隊員名單，或尚無隊員資料...' : '沒有找到相關隊員'}</div>`;
        return;
    }

    let html = "";
    filteredMembers.forEach(member => {
        let memberTotal = 0;
        let activeFeeCount = 0;
        const isCheckedPaid = showReconcile && !!member.isPaid;

        columns.forEach(col => {
            const val = parseFloat(member.values[col.id]) || 0;
            memberTotal += val;
            if (val !== 0) activeFeeCount++;
        });

        html += `
            <div class="bg-white rounded-xl p-3.5 sm:p-4 shadow-sm border ${isCheckedPaid ? 'border-emerald-300 bg-emerald-50/20' : 'border-slate-200'} flex flex-col justify-between hover:border-indigo-300 transition">
                <div>
                    <div class="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-2.5">
                        <div class="flex items-center gap-2">
                            <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-full ${isCheckedPaid ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-50 text-indigo-600'} font-bold flex items-center justify-center text-xs">
                                ${isCheckedPaid ? '<i class="fa-solid fa-check"></i>' : member.name.substring(0, 1)}
                            </div>
                            <div>
                                <div class="flex items-center gap-1.5">
                                    <span class="font-bold text-slate-800 text-xs sm:text-sm">${member.name}</span>
                                    ${isCheckedPaid ? `<span class="bg-emerald-100 text-emerald-800 text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded">對帳完成</span>` : ''}
                                </div>
                            </div>
                        </div>
                        <div class="text-right">
                            <span class="text-[10px] sm:text-[11px] text-slate-400 block">應繳總額</span>
                            <strong class="text-xs sm:text-sm font-bold font-mono text-indigo-700">NT$ ${memberTotal.toLocaleString()}</strong>
                        </div>
                    </div>
                    <div class="text-xs text-slate-500 mb-2.5 flex items-center justify-between">
                        <span class="text-[11px] sm:text-xs">已登錄項目: <strong class="text-slate-700">${activeFeeCount}</strong> 項</span>
                        ${showReconcile ? `
                            <div class="inline-flex items-center gap-1.5">
                                <span class="text-[10px] sm:text-[11px] font-semibold text-rose-700">姜宸媽對帳</span>
                                <button type="button"
                                    ${isAdminLoggedIn ? `onclick="toggleMemberPaid('${member.id}', ${!isCheckedPaid})"` : ''}
                                    class="${isAdminLoggedIn ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}"
                                    title="${isAdminLoggedIn ? (isCheckedPaid ? '取消對帳' : '點擊對帳') : (isCheckedPaid ? '對帳完成' : '未對帳')}">
                                    ${isCheckedPaid ? 
                                        `<i class="fa-solid fa-square-check text-emerald-500 text-base"></i>` : 
                                        `<i class="fa-regular fa-square text-slate-300 text-base"></i>`
                                    }
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="flex gap-2 pt-2 border-t border-slate-50">
                    <button onclick="openMobileEditModal('${member.id}')" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium text-xs py-1.5 sm:py-2 rounded-lg transition flex items-center justify-center gap-1">
                        <i class="fa-solid fa-pen-to-square"></i>
                        <span>${isAdminLoggedIn ? '編輯明細' : '檢視明細'}</span>
                    </button>
                    ${isAdminLoggedIn ? `
                        <button onclick="deleteMember('${member.id}')" class="bg-rose-50 hover:bg-rose-100 text-rose-600 px-2.5 py-1.5 sm:py-2 rounded-lg text-xs font-medium transition" title="刪除隊員">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// ==========================================
// 彈跳視窗操作 (隊員、欄位、備註、手機編輯)
// ==========================================
function openMobileEditModal(memberId) {
    const member = members.find(m => m.id === memberId);
    if (!member) return;

    document.getElementById("mobileEditModalName").innerText = `${member.name} - 明細${isAdminLoggedIn ? '編輯' : '檢視'}`;
   
    let total = 0;
    let html = "";
    columns.forEach(col => {
        const val = member.values[col.id] !== undefined ? member.values[col.id] : "";
        const numVal = parseFloat(val) || 0;
        total += numVal;
        
        let inputHtml = isAdminLoggedIn
            ? `<input type="number" value="${val}" placeholder="0" onchange="updateMemberValue('${member.id}', '${col.id}', this.value); updateMobileModalTotal('${member.id}')" class="w-24 sm:w-28 px-2 py-1 text-right bg-white border border-slate-300 rounded-md font-mono text-xs focus:ring-2 focus:ring-indigo-500">`
            : `<span class="w-24 sm:w-28 px-2 py-1 text-right font-mono text-sm ${numVal < 0 ? 'text-rose-600 font-semibold' : 'text-slate-800 font-medium'}">${val !== "" ? val : '0'}</span>`;

        html += `
            <div class="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
                <label class="text-xs font-medium text-slate-700 truncate flex-1" title="${col.title}">${col.title}</label>
                ${inputHtml}
            </div>
        `;
    });

    document.getElementById("mobileEditFormBody").innerHTML = html;
    document.getElementById("mobileEditModalTotal").innerText = `應繳: NT$ ${total.toLocaleString()}`;
    document.getElementById("mobileEditModal").classList.remove("hidden");
}

function updateMobileModalTotal(memberId) {
    const member = members.find(m => m.id === memberId);
    if (!member) return;
    let total = 0;
    columns.forEach(col => {
        total += parseFloat(member.values[col.id]) || 0;
    });
    document.getElementById("mobileEditModalTotal").innerText = `應繳: NT$ ${total.toLocaleString()}`;
}

function closeMobileEditModal() {
    document.getElementById("mobileEditModal").classList.add("hidden");
    renderTable();
    renderCards();
}

function openAddMemberModal() {
    if (!isAdminLoggedIn) return;
    document.getElementById("memberModalTitle").innerText = "新增成員";
    document.getElementById("editMemberId").value = "";
    document.getElementById("memberNameInput").value = "";
    document.getElementById("btnDeleteMemberInModal").classList.add("hidden");
    document.getElementById("memberModal").classList.remove("hidden");
    document.getElementById("memberNameInput").focus();
}

function openEditMemberModal(id) {
    if (!isAdminLoggedIn) return;
    const m = members.find(item => item.id === id);
    if (!m) return;
    document.getElementById("memberModalTitle").innerText = "修改隊員姓名";
    document.getElementById("editMemberId").value = id;
    document.getElementById("memberNameInput").value = m.name;
    document.getElementById("btnDeleteMemberInModal").classList.remove("hidden");
    document.getElementById("memberModal").classList.remove("hidden");
    document.getElementById("memberNameInput").focus();
}

function closeMemberModal() {
    document.getElementById("memberModal").classList.add("hidden");
}

function deleteMemberFromModal() {
    if (!isAdminLoggedIn) return;
    const editId = document.getElementById("editMemberId").value;
    if (editId) {
        deleteMember(editId);
        closeMemberModal();
    }
}

function saveMember() {
    if (!isAdminLoggedIn) return;
    const nameInput = document.getElementById("memberNameInput").value.trim();
    const editId = document.getElementById("editMemberId").value;
    if (!nameInput) {
        alert("請輸入成員姓名！");
        return;
    }

    if (editId) {
        const member = members.find(m => m.id === editId);
        if (member) {
            member.name = nameInput;
            showToast(`已成功修改隊員姓名為: ${nameInput}`);
        }
    } else {
        members.push({
            id: "m_" + Date.now(),
            name: nameInput,
            values: {}
        });
        showToast(`已成功新增隊員: ${nameInput}`);
    }

    saveState();
    renderTable();
    renderCards();
    closeMemberModal();
}

function deleteMember(id) {
    if (!isAdminLoggedIn) return;
    const m = members.find(item => item.id === id);
    if (m && confirm(`確定要刪除隊員 "${m.name}" 嗎？刪除後不可恢復。`)) {
        members = members.filter(item => item.id !== id);
        saveState();
        renderTable();
        renderCards();
        showToast(`已刪除隊員 "${m.name}"`);
    }
}

function openAddColumnModal() {
    if (!isAdminLoggedIn) return;
    document.getElementById("columnModalTitle").innerText = "新增費用支出項目 (欄位)";
    document.getElementById("editColumnId").value = "";
    document.getElementById("columnTitleInput").value = "";
    document.getElementById("columnNoteInput").value = "";
    document.getElementById("columnModal").classList.remove("hidden");
    document.getElementById("columnTitleInput").focus();
}

function openEditColumnModal(colId) {
    if (!isAdminLoggedIn) return;
    const col = columns.find(c => c.id === colId);
    if (!col) return;
    document.getElementById("columnModalTitle").innerText = "修改費用項目名稱與備註";
    document.getElementById("editColumnId").value = colId;
    document.getElementById("columnTitleInput").value = col.title || "";
    document.getElementById("columnNoteInput").value = col.note || "";
    document.getElementById("columnModal").classList.remove("hidden");
    document.getElementById("columnTitleInput").focus();
}

function closeColumnModal() {
    document.getElementById("columnModal").classList.add("hidden");
}

function saveColumn() {
    if (!isAdminLoggedIn) return;
    const titleInput = document.getElementById("columnTitleInput").value.trim();
    const noteInput = document.getElementById("columnNoteInput").value.trim();
    const editId = document.getElementById("editColumnId").value;
    if (!titleInput) {
        alert("請輸入項目名稱！");
        return;
    }

    if (editId) {
        const col = columns.find(c => c.id === editId);
        if (col) {
            col.title = titleInput;
            col.note = noteInput;
            showToast(`已更新項目: ${titleInput}`);
        }
    } else {
        columns.push({
            id: "col_" + Date.now(),
            title: titleInput,
            note: noteInput
        });
        showToast(`已新增費用欄位: ${titleInput}`);
    }

    saveState();
    renderTable();
    renderCards();
    closeColumnModal();
}

function openNoteModal(colId) {
    const col = columns.find(c => c.id === colId);
    if (!col) return;
    document.getElementById("noteModalTitle").innerText = col.title;
    document.getElementById("noteModalContent").innerText = col.note && col.note.trim() !== "" ? col.note : "尚無詳細說明。";
    document.getElementById("noteModal").classList.remove("hidden");
}

function closeNoteModal() {
    document.getElementById("noteModal").classList.add("hidden");
}

function deleteColumn(colId) {
    if (!isAdminLoggedIn) return;
    const col = columns.find(c => c.id === colId);
    if (col && confirm(`確定要刪除欄位 "${col.title}" 嗎？這將會清空全體成員在該項目的金額。`)) {
        columns = columns.filter(c => c.id !== colId);
        members.forEach(m => {
            delete m.values[colId];
        });
        saveState();
        renderTable();
        renderCards();
        showToast(`已刪除項目: ${col.title}`);
    }
}

// ==========================================
// Excel 匯入與匯出
// ==========================================
function triggerExcelImport() {
    if (!isAdminLoggedIn) return;
    document.getElementById("excelFileInput").click();
}

function handleExcelImport(event) {
    if (!isAdminLoggedIn) return;
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        alert("Excel 解析模組載入失敗，請檢查網路連線。");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            pendingWorkbook = XLSX.read(data, { type: 'array' });
            
            if (!pendingWorkbook || !pendingWorkbook.SheetNames || pendingWorkbook.SheetNames.length === 0) {
                alert("Excel 檔案未包含任何工作表！");
                return;
            }

            renderSheetSelectionModal(pendingWorkbook.SheetNames);
        } catch (err) {
            console.error(err);
            alert("讀取 Excel 檔案時發生錯誤，請確定檔案無損壞。");
        } finally {
            event.target.value = "";
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderSheetSelectionModal(sheetNames) {
    const container = document.getElementById("excelSheetList");
    document.getElementById("targetImportMonthLabel").innerText = currentMonth;

    container.innerHTML = sheetNames.map((name, idx) => `
        <label class="flex items-center justify-between p-3 bg-slate-50 hover:bg-indigo-50/50 border border-slate-200 rounded-lg cursor-pointer transition">
            <div class="flex items-center gap-2">
                <i class="fa-regular fa-file-lines text-indigo-500 text-base"></i>
                <span class="text-sm font-medium text-slate-800">${name}</span>
            </div>
            <input type="radio" name="selectedExcelSheet" value="${name}" ${idx === 0 ? 'checked' : ''} class="w-4 h-4 text-indigo-600 focus:ring-indigo-500">
        </label>
    `).join("");
    document.getElementById("excelSheetModal").classList.remove("hidden");
}

function closeExcelSheetModal() {
    document.getElementById("excelSheetModal").classList.add("hidden");
    pendingWorkbook = null;
}

function confirmImportSelectedSheet() {
    if (!isAdminLoggedIn || !pendingWorkbook) return;

    const radios = document.querySelectorAll('input[name="selectedExcelSheet"]:checked');
    if (radios.length === 0) {
        alert("請選擇一個工作表！");
        return;
    }

    const sheetName = radios[0].value;
    const worksheet = pendingWorkbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (!jsonData || jsonData.length < 2) {
        alert(`「${sheetName}」工作表內容為空或格式不正確！`);
        return;
    }

    closeExcelSheetModal();
    openImportOptionModal(jsonData, sheetName);
}

function openImportOptionModal(jsonData, sheetName) {
    pendingImportData = { jsonData, sheetName };
    document.getElementById("importOptionSheetName").innerText = sheetName;
    document.getElementById("importOptionMonthName").innerText = currentMonth;
    document.querySelectorAll(".importOptionMonthText").forEach(el => el.innerText = currentMonth);
    document.getElementById("importOptionModal").classList.remove("hidden");
}

function closeImportOptionModal() {
    document.getElementById("importOptionModal").classList.add("hidden");
    pendingImportData = null;
}

function executeImportWithMode() {
    if (!isAdminLoggedIn || !pendingImportData) return;
    const selectedRadio = document.querySelector('input[name="importModeRadio"]:checked');
    if (!selectedRadio) {
        alert("請選擇一種資料處理方式！");
        return;
    }

    const mode = selectedRadio.value;
    const { jsonData, sheetName } = pendingImportData;

    closeImportOptionModal();
    processImportData(jsonData, sheetName, mode);
}

function processImportData(jsonData, sheetName, mode) {
    if (!isAdminLoggedIn) return;

    if (mode === 'replace') {
        members = [];
    }

    const headerRow = jsonData[0];
    let nameColIdx = -1;

    headerRow.forEach((colName, index) => {
        if (!colName) return;
        const trimmed = String(colName).trim();
        if (trimmed === "姓名" || trimmed === "成員姓名" || trimmed === "Name") {
            nameColIdx = index;
        }
    });

    if (nameColIdx === -1) nameColIdx = 0;

    const excelColMapping = {};

    headerRow.forEach((colName, index) => {
        if (index === nameColIdx || !colName) return;
        const trimmed = String(colName).trim();
        if (trimmed === "應繳金額" || trimmed === "合計" || trimmed === "總計" || trimmed === "#" || trimmed === "序號" || trimmed.includes("對帳")) {
            return;
        }

        let existingCol = columns.find(c => c.title.trim().toLowerCase() === trimmed.toLowerCase());
        if (!existingCol) {
            existingCol = {
                id: "col_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
                title: trimmed,
                note: ""
            };
            columns.push(existingCol);
        }
        excelColMapping[index] = existingCol.id;
    });

    let addedMemberCount = 0;

    for (let r = 1; r < jsonData.length; r++) {
        const row = jsonData[r];
        if (!row || row.length === 0) continue;

        const rawName = row[nameColIdx];
        if (!rawName) continue;
        const memberName = String(rawName).trim();

        if (memberName === "合計" || memberName === "總計" || memberName === "Total") continue;

        let targetMember = members.find(m => m.name.trim().toLowerCase() === memberName.toLowerCase());
        if (!targetMember) {
            targetMember = {
                id: "m_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
                name: memberName,
                values: {}
            };
            members.push(targetMember);
            addedMemberCount++;
        }

        Object.keys(excelColMapping).forEach(cIdx => {
            const colId = excelColMapping[cIdx];
            const cellValue = row[cIdx];
            const val = parseFloat(cellValue);
           
            if (cellValue !== undefined && cellValue !== null && cellValue !== "" && !isNaN(val)) {
                targetMember.values[colId] = val;
            }
        });
    }

    saveState();
    renderTable();
    renderCards();
    showToast(`已成功從「${sheetName}」分頁匯入資料！（新增 ${addedMemberCount} 位隊員，共 ${members.length} 人）`);
}

function exportToExcel() {
    if (!isAdminLoggedIn) return;
    if (typeof XLSX === 'undefined') {
        alert("Excel 匯出模組載入失敗，請檢查網路連線。");
        return;
    }

    const showReconcile = isReconcileEnabled();
    const headers = showReconcile
        ? ["姓名", ...columns.map(c => c.title), "【姜宸媽追殺區】對帳", "應繳金額"]
        : ["姓名", ...columns.map(c => c.title), "應繳金額"];
    const data = [headers];

    let grandTotal = 0;
    const columnTotals = {};
    columns.forEach(c => columnTotals[c.id] = 0);
    let totalPaidCount = 0;

    members.forEach(member => {
        let memberTotal = 0;
        const row = [member.name];

        columns.forEach(col => {
            const val = member.values[col.id] !== undefined ? parseFloat(member.values[col.id]) : 0;
            row.push(val !== 0 ? val : "");
            memberTotal += val;
            columnTotals[col.id] += val;
        });

        if (showReconcile) {
            if (member.isPaid) totalPaidCount++;
            row.push(member.isPaid ? "已對帳" : "未對帳");
        }
        row.push(memberTotal);
        grandTotal += memberTotal;
        data.push(row);
    });

    const totalRow = ["合計"];
    columns.forEach(col => {
        totalRow.push(columnTotals[col.id] || 0);
    });
    if (showReconcile) {
        totalRow.push(`完成: ${totalPaidCount}/${members.length}`);
    }
    totalRow.push(grandTotal);
    data.push(totalRow);

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `${currentMonth}_費用統計`);

    worksheet['!cols'] = headers.map(h => ({ wch: Math.max(h.length * 3, 12) }));

    XLSX.writeFile(workbook, `團隊費用統計表_${currentMonth}.xlsx`);
    showToast("Excel 統計表匯出成功！");
}

function handleSearch() {
    searchQuery = document.getElementById("searchInput").value;
    renderTable();
    renderCards();
}

function showToast(message) {
    const toast = document.getElementById("toast");
    const toastText = document.getElementById("toastText");
    toastText.innerText = message;
    toast.classList.remove("opacity-0", "pointer-events-none");
    toast.classList.add("opacity-100");

    setTimeout(() => {
        toast.classList.remove("opacity-100");
        toast.classList.add("opacity-0", "pointer-events-none");
    }, 2500);
}

// 掛載至 window 供 HTML 行內事件呼叫
Object.assign(window, {
    fetchXinfengWeather: (isManual) => fetchXinfengWeather(isManual, showToast),
    fetchTaiwanStockIndex: (isManual) => fetchTaiwanStockIndex(isManual, showToast),
    handleAdminBtnClick,
    logoutAdmin,
    openAdminModal,
    closeAdminModal,
    checkAdminPassword,
    handleMonthDragStart,
    handleMonthDragOver,
    handleMonthDragEnter,
    handleMonthDragLeave,
    handleMonthDrop,
    handleMonthDragEnd,
    loadMonthData,
    toggleMonthReconcile,
    toggleMonthVisibility,
    openAddMonthModal,
    closeMonthModal,
    toggleSelectAllMonthCols,
    saveNewMonth,
    openEditMonthModal,
    closeEditMonthModal,
    saveEditedMonthName,
    deleteMonth,
    switchViewMode,
    copyAmount,
    clearCopiedAmount,
    openBatchPasteModal,
    closeBatchPasteModal,
    toggleSelectAllBatchMembers,
    applyBatchPaste,
    renderTable,
    renderCards,
    updateMemberValue,
    toggleMemberPaid,
    openMobileEditModal,
    updateMobileModalTotal,
    closeMobileEditModal,
    openAddMemberModal,
    openEditMemberModal,
    closeMemberModal,
    deleteMemberFromModal,
    saveMember,
    deleteMember,
    openAddColumnModal,
    openEditColumnModal,
    closeColumnModal,
    saveColumn,
    openNoteModal,
    closeNoteModal,
    deleteColumn,
    triggerExcelImport,
    handleExcelImport,
    closeExcelSheetModal,
    confirmImportSelectedSheet,
    openImportOptionModal,
    closeImportOptionModal,
    executeImportWithMode,
    exportToExcel,
    handleSearch,
    showToast
});

window.addEventListener("DOMContentLoaded", initApp);
