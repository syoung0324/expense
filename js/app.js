import {
    getDoc,
    setDoc,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    firebaseConfig,
    db,
    dataDocRef,
    adminDocRef,
    DEFAULT_MONTH_KEY,
    INITIAL_COLUMNS,
    INITIAL_MEMBERS
} from "./firebase-config.js";
import {
    fetchXinfengWeather,
    fetchTaiwanStockIndex,
    fetchTaiwanHotNews
} from "./widgets.js";

const LOCAL_STORAGE_KEY = "team_expense_tracker_data_v1";
const ADMIN_SESSION_KEY = "team_expense_is_admin";

let useCloudSync = false;
let unsubscribeSnapshot = null;

// ==========================================
// 1. 全域狀態管理
// ==========================================
let appData = {
    months: {},       // { "2026年11月": { columns: [{ id, title, note }], members: [{ id, name, fees: { colId: 0 } }] } }
    monthOrder: []    // ["2026年11月", ...]
};

let currentMonth = "";
let viewMode = "table"; // "table" | "cards"
let searchQuery = "";
let copiedAmount = null;
let isAdmin = sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";

// Excel 匯入暫存狀態
let pendingWorkbook = null;
let selectedSheetName = "";

// ==========================================
// 2. 工具函式：Toast 提示 & 同步狀態
// ==========================================
let toastTimer = null;
function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    const icon = document.getElementById("toastIcon");
    const text = document.getElementById("toastText");
    if (!toast || !text) return;

    text.textContent = message;
    if (type === "error") {
        icon.className = "fa-solid fa-circle-exclamation text-rose-400 text-sm sm:text-base";
    } else if (type === "warn") {
        icon.className = "fa-solid fa-triangle-exclamation text-amber-400 text-sm sm:text-base";
    } else {
        icon.className = "fa-solid fa-circle-check text-emerald-400 text-sm sm:text-base";
    }

    toast.classList.remove("opacity-0");
    toast.classList.add("opacity-100");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("opacity-100");
        toast.classList.add("opacity-0");
    }, 2800);
}

function updateSyncBadge(status, text) {
    const badge = document.getElementById("syncStatusBadge");
    const icon = document.getElementById("syncStatusIcon");
    const label = document.getElementById("syncStatusText");
    if (!badge || !icon || !label) return;

    label.textContent = text;
    if (status === "synced") {
        badge.className = "flex items-center gap-1 bg-indigo-800/90 text-emerald-300 text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full border border-indigo-500/50 shadow-inner shrink-0";
        icon.className = "fa-solid fa-cloud-check text-[10px]";
    } else if (status === "syncing") {
        badge.className = "flex items-center gap-1 bg-indigo-800/90 text-amber-300 text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full border border-indigo-500/50 shadow-inner shrink-0";
        icon.className = "fa-solid fa-arrows-rotate fa-spin text-[10px]";
    } else {
        badge.className = "flex items-center gap-1 bg-indigo-900/90 text-slate-300 text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full border border-indigo-500/40 shadow-inner shrink-0";
        icon.className = "fa-solid fa-hard-drive text-[10px]";
    }
}

function generateId(prefix = "id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ==========================================
// 3. 資料持久化與 Firestore 同步
// ==========================================
function getDefaultSampleData() {
    const defaultMonth = DEFAULT_MONTH_KEY || `${new Date().getFullYear()}年${new Date().getMonth() + 1}月`;
    return {
        monthOrder: [defaultMonth],
        months: {
            [defaultMonth]: {
                columns: INITIAL_COLUMNS.map((c) => ({ ...c })),
                members: INITIAL_MEMBERS.map((m) => ({ ...m }))
            }
        }
    };
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.months && Array.isArray(parsed.monthOrder) && parsed.monthOrder.length > 0) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn("讀取本地快取失敗:", e);
    }
    return getDefaultSampleData();
}

async function saveData() {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(appData));
    renderAll();

    if (useCloudSync && db) {
        try {
            updateSyncBadge("syncing", "同步中...");
            await setDoc(dataDocRef, {
                monthOrder: appData.monthOrder,
                months: appData.months,
                updatedAt: new Date().toISOString()
            });
            updateSyncBadge("synced", "雲端已同步");
        } catch (err) {
            console.error("Firestore 寫入失敗:", err);
            updateSyncBadge("local", "雲端寫入失敗 (已存本機)");
            showToast("雲端同步失敗，資料已暫存於本機", "error");
        }
    } else {
        updateSyncBadge("local", "本機儲存模式");
    }
}

function initFirebaseAndData() {
    const localInitial = loadFromLocalStorage();
    appData = localInitial;
    if (!currentMonth || !appData.months[currentMonth]) {
        currentMonth = appData.monthOrder[0] || Object.keys(appData.months)[0] || "";
    }
    renderAll();

    if (!firebaseConfig?.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY" || !db) {
        updateSyncBadge("local", "本機儲存模式");
        return;
    }

    try {
        useCloudSync = true;
        updateSyncBadge("syncing", "連線雲端中...");

        unsubscribeSnapshot = onSnapshot(
            dataDocRef,
            async (snap) => {
                if (snap.exists()) {
                    const cloud = snap.data();
                    if (cloud.months && Array.isArray(cloud.monthOrder) && cloud.monthOrder.length > 0) {
                        appData = {
                            monthOrder: cloud.monthOrder,
                            months: cloud.months
                        };
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(appData));
                        if (!currentMonth || !appData.months[currentMonth]) {
                            currentMonth = appData.monthOrder[0];
                        }
                        renderAll();
                    }
                } else {
                    await setDoc(dataDocRef, {
                        monthOrder: appData.monthOrder,
                        months: appData.months,
                        updatedAt: new Date().toISOString()
                    });
                }
                updateSyncBadge("synced", "雲端已同步");
            },
            (err) => {
                console.error("Firestore 監聽異常:", err);
                useCloudSync = false;
                updateSyncBadge("local", "離線 / 本機模式");
            }
        );
    } catch (e) {
        console.error("Firebase 監聽啟動失敗:", e);
        useCloudSync = false;
        updateSyncBadge("local", "本機儲存模式");
    }
}

// ==========================================
// 4. 管理者權限控制（支援 Firestore 後端密碼驗證）
// ==========================================
function updateAdminUI() {
    const adminBtnText = document.getElementById("adminBtnText");
    const adminProtectedIds = [
        "btnImportExcel",
        "btnExportExcel",
        "btnAddMonthBtn",
        "btnAddMemberBtn",
        "btnAddColumnBtn"
    ];

    if (adminBtnText) {
        adminBtnText.textContent = isAdmin ? "管理者已登入 (登出)" : "管理者登入";
    }

    adminProtectedIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (isAdmin) {
            el.classList.remove("hidden");
        } else {
            el.classList.add("hidden");
        }
    });

    renderAll();
}

function handleAdminBtnClick() {
    if (isAdmin) {
        isAdmin = false;
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
        updateAdminUI();
        showToast("已登出管理者模式");
    } else {
        const input = document.getElementById("adminPasswordInput");
        if (input) input.value = "";
        document.getElementById("adminModal")?.classList.remove("hidden");
        setTimeout(() => input?.focus(), 50);
    }
}

function closeAdminModal() {
    document.getElementById("adminModal")?.classList.add("hidden");
}

async function checkAdminPassword() {
    const input = document.getElementById("adminPasswordInput");
    const pwd = (input?.value || "").trim();
    if (!pwd) {
        showToast("請輸入管理者密碼", "warn");
        return;
    }

    let validPassword = null;

    // 優先從共用的 adminDocRef (config/admin) 讀取密碼
    if (useCloudSync && db) {
        try {
            const adminDoc = await getDoc(adminDocRef);
            if (adminDoc.exists() && adminDoc.data().password) {
                validPassword = String(adminDoc.data().password);
            }
        } catch (e) {
            console.warn("讀取雲端管理者設定失敗:", e);
        }
    }

    // 若尚未設定 Firestore 密碼文件時的備援比對
    if (!validPassword) {
        validPassword = localStorage.getItem("custom_admin_pwd") || "admin1234";
    }

    if (pwd === validPassword) {
        isAdmin = true;
        sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
        closeAdminModal();
        updateAdminUI();
        showToast("管理者登入成功");
    } else {
        showToast("密碼錯誤，請重新輸入", "error");
        input?.select();
    }
}

// ==========================================
// 5. 月份分頁管理
// ==========================================
function renderMonthTabs() {
    const container = document.getElementById("monthTabsContainer");
    if (!container) return;

    container.innerHTML = appData.monthOrder
        .filter((m) => appData.months[m])
        .map((monthName) => {
            const isActive = monthName === currentMonth;
            const activeClass = isActive
                ? "bg-indigo-600 text-white shadow-sm border-indigo-600"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200";

            const adminActions = isAdmin && isActive
                ? `
                    <span onclick="event.stopPropagation(); openEditMonthModal('${escapeHtml(monthName)}')" class="ml-1.5 text-indigo-200 hover:text-white text-[11px]" title="重新命名月份">
                        <i class="fa-solid fa-pen"></i>
                    </span>
                    ${appData.monthOrder.length > 1 ? `
                        <span onclick="event.stopPropagation(); deleteMonth('${escapeHtml(monthName)}')" class="ml-1 text-indigo-200 hover:text-rose-300 text-[11px]" title="刪除此月份">
                            <i class="fa-solid fa-trash-can"></i>
                        </span>
                    ` : ""}
                `
                : "";

            return `
                <button onclick="selectMonth('${escapeHtml(monthName)}')"
                    class="px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border transition whitespace-nowrap flex items-center ${activeClass}">
                    <span>${escapeHtml(monthName)}</span>
                    ${adminActions}
                </button>
            `;
        })
        .join("");
}

function selectMonth(monthName) {
    if (!appData.months[monthName]) return;
    currentMonth = monthName;
    renderAll();
}

function openAddMonthModal() {
    const nameInput = document.getElementById("monthNameInput");
    const boxContainer = document.getElementById("monthColumnCheckboxes");
    if (!nameInput || !boxContainer) return;

    nameInput.value = "";
    const curData = appData.months[currentMonth] || { columns: [] };

    if (curData.columns.length === 0) {
        boxContainer.innerHTML = `<p class="text-xs text-slate-400">目前月份無費用項目可複製</p>`;
    } else {
        boxContainer.innerHTML = curData.columns
            .map(
                (col) => `
                <label class="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" value="${escapeHtml(col.id)}" checked class="month-col-checkbox rounded text-indigo-600 focus:ring-indigo-500">
                    <span>${escapeHtml(col.title)}</span>
                </label>
            `
            )
            .join("");
    }

    document.getElementById("monthModal")?.classList.remove("hidden");
    setTimeout(() => nameInput.focus(), 50);
}

function closeMonthModal() {
    document.getElementById("monthModal")?.classList.add("hidden");
}

function toggleSelectAllMonthCols() {
    const checkboxes = Array.from(document.querySelectorAll(".month-col-checkbox"));
    const allChecked = checkboxes.every((cb) => cb.checked);
    checkboxes.forEach((cb) => {
        cb.checked = !allChecked;
    });
}

async function saveNewMonth() {
    const nameInput = document.getElementById("monthNameInput");
    const newName = (nameInput?.value || "").trim();
    if (!newName) {
        showToast("請輸入月份名稱", "warn");
        return;
    }
    if (appData.months[newName]) {
        showToast("此月份名稱已存在", "error");
        return;
    }

    const copyRoster = document.getElementById("copyRosterCheck")?.checked;
    const selectedColIds = new Set(
        Array.from(document.querySelectorAll(".month-col-checkbox:checked")).map((cb) => cb.value)
    );

    const sourceMonth = appData.months[currentMonth] || { columns: [], members: [] };
    const colIdMap = {};
    const newColumns = sourceMonth.columns
        .filter((c) => selectedColIds.has(c.id))
        .map((c) => {
            const newId = generateId("col");
            colIdMap[c.id] = newId;
            return { id: newId, title: c.title, note: c.note || "" };
        });

    const newMembers = copyRoster
        ? sourceMonth.members.map((m) => ({
              id: generateId("mem"),
              name: m.name,
              fees: {}
          }))
        : [];

    appData.months[newName] = {
        columns: newColumns,
        members: newMembers
    };
    appData.monthOrder.push(newName);
    currentMonth = newName;

    closeMonthModal();
    await saveData();
    showToast(`已建立「${newName}」帳目`);
}

function openEditMonthModal(monthName) {
    document.getElementById("oldMonthNameInput").value = monthName;
    document.getElementById("newMonthNameInput").value = monthName;
    document.getElementById("editMonthModal")?.classList.remove("hidden");
}

function closeEditMonthModal() {
    document.getElementById("editMonthModal")?.classList.add("hidden");
}

async function saveEditedMonthName() {
    const oldName = document.getElementById("oldMonthNameInput").value;
    const newName = (document.getElementById("newMonthNameInput").value || "").trim();

    if (!newName) {
        showToast("月份名稱不能為空", "warn");
        return;
    }
    if (newName === oldName) {
        closeEditMonthModal();
        return;
    }
    if (appData.months[newName]) {
        showToast("該月份名稱已存在", "error");
        return;
    }

    appData.months[newName] = appData.months[oldName];
    delete appData.months[oldName];
    appData.monthOrder = appData.monthOrder.map((m) => (m === oldName ? newName : m));
    if (currentMonth === oldName) currentMonth = newName;

    closeEditMonthModal();
    await saveData();
    showToast(`已更名為「${newName}」`);
}

async function deleteMonth(monthName) {
    if (appData.monthOrder.length <= 1) {
        showToast("至少需保留一個月份分頁", "warn");
        return;
    }
    if (!confirm(`確定要刪除「${monthName}」的所有帳目資料嗎？此操作無法復原。`)) return;

    delete appData.months[monthName];
    appData.monthOrder = appData.monthOrder.filter((m) => m !== monthName);
    if (currentMonth === monthName) {
        currentMonth = appData.monthOrder[0];
    }

    await saveData();
    showToast(`已刪除「${monthName}」`);
}

// ==========================================
// 6. 費用項目（欄位）新增、編輯、刪除與備註
// ==========================================
function openAddColumnModal() {
    document.getElementById("columnModalTitle").textContent = "新增費用支出項目 (欄位)";
    document.getElementById("editColumnId").value = "";
    document.getElementById("columnTitleInput").value = "";
    document.getElementById("columnNoteInput").value = "";
    document.getElementById("columnModal")?.classList.remove("hidden");
    setTimeout(() => document.getElementById("columnTitleInput")?.focus(), 50);
}

function openEditColumnModal(colId) {
    const monthObj = appData.months[currentMonth];
    const col = monthObj?.columns.find((c) => c.id === colId);
    if (!col) return;

    document.getElementById("columnModalTitle").textContent = "編輯費用項目";
    document.getElementById("editColumnId").value = col.id;
    document.getElementById("columnTitleInput").value = col.title;
    document.getElementById("columnNoteInput").value = col.note || "";
    document.getElementById("columnModal")?.classList.remove("hidden");
}

function closeColumnModal() {
    document.getElementById("columnModal")?.classList.add("hidden");
}

async function saveColumn() {
    const colId = document.getElementById("editColumnId").value;
    const title = (document.getElementById("columnTitleInput").value || "").trim();
    const note = (document.getElementById("columnNoteInput").value || "").trim();

    if (!title) {
        showToast("請輸入費用項目名稱", "warn");
        return;
    }

    const monthObj = appData.months[currentMonth];
    if (!monthObj) return;

    if (colId) {
        const col = monthObj.columns.find((c) => c.id === colId);
        if (col) {
            col.title = title;
            col.note = note;
        }
        showToast("已更新費用項目");
    } else {
        monthObj.columns.push({
            id: generateId("col"),
            title,
            note
        });
        showToast(`已新增項目「${title}」`);
    }

    closeColumnModal();
    await saveData();
}

async function deleteColumn(colId) {
    const monthObj = appData.months[currentMonth];
    const col = monthObj?.columns.find((c) => c.id === colId);
    if (!col) return;

    if (!confirm(`確定要刪除費用項目「${col.title}」嗎？該欄位的金額紀錄將一併移除。`)) return;

    monthObj.columns = monthObj.columns.filter((c) => c.id !== colId);
    monthObj.members.forEach((m) => {
        if (m.fees) delete m.fees[colId];
    });

    await saveData();
    showToast(`已刪除項目「${col.title}」`);
}

function openNoteModal(colId) {
    const monthObj = appData.months[currentMonth];
    const col = monthObj?.columns.find((c) => c.id === colId);
    if (!col) return;

    document.getElementById("noteModalTitle").textContent = `${col.title} - 說明`;
    document.getElementById("noteModalContent").textContent = col.note || "無備註說明";
    document.getElementById("noteModal")?.classList.remove("hidden");
}

function closeNoteModal() {
    document.getElementById("noteModal")?.classList.add("hidden");
}

// ==========================================
// 7. 隊員新增、編輯、刪除
// ==========================================
function openAddMemberModal() {
    document.getElementById("memberModalTitle").textContent = "新增成員";
    document.getElementById("editMemberId").value = "";
    document.getElementById("memberNameInput").value = "";
    document.getElementById("btnDeleteMemberInModal")?.classList.add("hidden");
    document.getElementById("memberModal")?.classList.remove("hidden");
    setTimeout(() => document.getElementById("memberNameInput")?.focus(), 50);
}

function openEditMemberModal(memberId) {
    if (!isAdmin) return;
    const monthObj = appData.months[currentMonth];
    const member = monthObj?.members.find((m) => m.id === memberId);
    if (!member) return;

    document.getElementById("memberModalTitle").textContent = "編輯成員資料";
    document.getElementById("editMemberId").value = member.id;
    document.getElementById("memberNameInput").value = member.name;
    document.getElementById("btnDeleteMemberInModal")?.classList.remove("hidden");
    document.getElementById("memberModal")?.classList.remove("hidden");
}

function closeMemberModal() {
    document.getElementById("memberModal")?.classList.add("hidden");
}

async function saveMember() {
    const memberId = document.getElementById("editMemberId").value;
    const name = (document.getElementById("memberNameInput").value || "").trim();
    if (!name) {
        showToast("請輸入成員姓名", "warn");
        return;
    }

    const monthObj = appData.months[currentMonth];
    if (!monthObj) return;

    if (memberId) {
        const member = monthObj.members.find((m) => m.id === memberId);
        if (member) member.name = name;
        showToast("已更新成員姓名");
    } else {
        monthObj.members.push({
            id: generateId("mem"),
            name,
            fees: {}
        });
        showToast(`已新增成員「${name}」`);
    }

    closeMemberModal();
    await saveData();
}

async function deleteMemberFromModal() {
    const memberId = document.getElementById("editMemberId").value;
    if (!memberId) return;
    const monthObj = appData.months[currentMonth];
    const member = monthObj?.members.find((m) => m.id === memberId);
    if (!member) return;

    if (!confirm(`確定要刪除成員「${member.name}」嗎？`)) return;

    monthObj.members = monthObj.members.filter((m) => m.id !== memberId);
    closeMemberModal();
    await saveData();
    showToast(`已刪除成員「${member.name}」`);
}

// ==========================================
// 8. 金額編輯、複製與批次貼上
// ==========================================
async function updateCellAmount(memberId, colId, rawVal) {
    if (!isAdmin) return;
    const monthObj = appData.months[currentMonth];
    const member = monthObj?.members.find((m) => m.id === memberId);
    if (!member) return;

    if (!member.fees) member.fees = {};
    const num = parseFloat(rawVal);
    member.fees[colId] = isNaN(num) ? 0 : num;

    await saveData();
}

function copyAmount(amount) {
    const num = Number(amount) || 0;
    copiedAmount = num;
    const badge = document.getElementById("copiedBadge");
    const text = document.getElementById("copiedAmountText");
    if (text) text.textContent = num.toLocaleString();
    if (badge) badge.classList.remove("hidden");

    const batchBtn = document.getElementById("btnBatchPaste");
    if (batchBtn) {
        batchBtn.style.display = isAdmin ? "flex" : "none";
    }

    showToast(`已複製金額：NT$ ${num.toLocaleString()}`);
}

function clearCopiedAmount() {
    copiedAmount = null;
    document.getElementById("copiedBadge")?.classList.add("hidden");
}

async function pasteAmountToCell(memberId, colId) {
    if (!isAdmin) return;
    if (copiedAmount === null) {
        showToast("尚未複製任何金額", "warn");
        return;
    }
    await updateCellAmount(memberId, colId, copiedAmount);
    showToast(`已貼上 NT$ ${copiedAmount.toLocaleString()}`);
}

function openBatchPasteModal() {
    if (!isAdmin || copiedAmount === null) return;
    const monthObj = appData.months[currentMonth];
    if (!monthObj || monthObj.columns.length === 0) {
        showToast("目前月份尚無費用項目可貼上", "warn");
        return;
    }

    document.getElementById("batchPasteAmountLabel").textContent = copiedAmount.toLocaleString();

    const colSelect = document.getElementById("batchTargetColumnSelect");
    colSelect.innerHTML = monthObj.columns
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`)
        .join("");

    const listEl = document.getElementById("batchMemberList");
    listEl.innerHTML = monthObj.members
        .map(
            (m) => `
            <label class="flex items-center justify-between py-1.5 px-2 hover:bg-slate-50 rounded cursor-pointer text-xs sm:text-sm">
                <span class="flex items-center gap-2">
                    <input type="checkbox" value="${escapeHtml(m.id)}" class="batch-member-cb rounded text-indigo-600 focus:ring-indigo-500">
                    <span class="font-medium text-slate-700">${escapeHtml(m.name)}</span>
                </span>
            </label>
        `
        )
        .join("");

    document.getElementById("batchPasteModal")?.classList.remove("hidden");
}

function closeBatchPasteModal() {
    document.getElementById("batchPasteModal")?.classList.add("hidden");
}

function toggleSelectAllBatchMembers() {
    const cbs = Array.from(document.querySelectorAll(".batch-member-cb"));
    const allChecked = cbs.every((cb) => cb.checked);
    cbs.forEach((cb) => {
        cb.checked = !allChecked;
    });
}

async function applyBatchPaste() {
    if (!isAdmin || copiedAmount === null) return;
    const colId = document.getElementById("batchTargetColumnSelect")?.value;
    const selectedMemberIds = Array.from(document.querySelectorAll(".batch-member-cb:checked")).map((cb) => cb.value);

    if (!colId || selectedMemberIds.length === 0) {
        showToast("請至少勾選一位隊員", "warn");
        return;
    }

    const monthObj = appData.months[currentMonth];
    monthObj.members.forEach((m) => {
        if (selectedMemberIds.includes(m.id)) {
            if (!m.fees) m.fees = {};
            m.fees[colId] = copiedAmount;
        }
    });

    closeBatchPasteModal();
    await saveData();
    showToast(`已批次填入 ${selectedMemberIds.length} 位隊員金額`);
}

// ==========================================
// 9. 行動版單人費用編輯視窗
// ==========================================
let currentMobileEditMemberId = null;

function openMobileEditModal(memberId) {
    if (!isAdmin) return;
    const monthObj = appData.months[currentMonth];
    const member = monthObj?.members.find((m) => m.id === memberId);
    if (!member) return;

    currentMobileEditMemberId = memberId;
    document.getElementById("mobileEditModalName").textContent = `${member.name} - 費用編輯`;

    const bodyEl = document.getElementById("mobileEditFormBody");
    bodyEl.innerHTML = monthObj.columns
        .map((col) => {
            const val = Number(member.fees?.[col.id] || 0);
            return `
                <div class="flex items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <div class="min-w-0 flex-1">
                        <div class="text-xs sm:text-sm font-semibold text-slate-700 truncate">${escapeHtml(col.title)}</div>
                        ${col.note ? `<div class="text-[11px] text-slate-400 truncate">${escapeHtml(col.note)}</div>` : ""}
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <input type="number" value="${val}"
                            onchange="handleMobileFeeChange('${escapeHtml(member.id)}', '${escapeHtml(col.id)}', this.value)"
                            class="w-24 px-2.5 py-1.5 text-right font-mono text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500">
                        ${copiedAmount !== null ? `
                            <button type="button" onclick="pasteInMobileModal('${escapeHtml(member.id)}', '${escapeHtml(col.id)}')"
                                class="px-2 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-xs" title="貼上複製金額">
                                <i class="fa-solid fa-paste"></i>
                            </button>
                        ` : ""}
                    </div>
                </div>
            `;
        })
        .join("");

    updateMobileModalTotal(member);
    document.getElementById("mobileEditModal")?.classList.remove("hidden");
}

function updateMobileModalTotal(member) {
    const monthObj = appData.months[currentMonth];
    const total = (monthObj?.columns || []).reduce((sum, c) => sum + (Number(member.fees?.[c.id]) || 0), 0);
    document.getElementById("mobileEditModalTotal").textContent = `應繳: NT$ ${total.toLocaleString()}`;
}

async function handleMobileFeeChange(memberId, colId, val) {
    await updateCellAmount(memberId, colId, val);
    const member = appData.months[currentMonth]?.members.find((m) => m.id === memberId);
    if (member) updateMobileModalTotal(member);
}

async function pasteInMobileModal(memberId, colId) {
    if (copiedAmount === null) return;
    await updateCellAmount(memberId, colId, copiedAmount);
    openMobileEditModal(memberId);
    showToast(`已貼上 NT$ ${copiedAmount.toLocaleString()}`);
}

function closeMobileEditModal() {
    currentMobileEditMemberId = null;
    document.getElementById("mobileEditModal")?.classList.add("hidden");
}

// ==========================================
// 10. 檢視模式切換、搜尋與畫面渲染
// ==========================================
function switchViewMode(mode) {
    viewMode = mode;
    const btnTable = document.getElementById("btnViewTable");
    const btnCards = document.getElementById("btnViewCards");
    const tableContainer = document.getElementById("tableViewContainer");
    const cardsContainer = document.getElementById("cardsViewContainer");

    if (mode === "table") {
        btnTable.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md bg-white text-indigo-700 shadow-sm transition";
        btnCards.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md text-slate-600 hover:text-indigo-600 transition";
        tableContainer?.classList.remove("hidden");
        cardsContainer?.classList.add("hidden");
    } else {
        btnCards.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md bg-white text-indigo-700 shadow-sm transition";
        btnTable.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md text-slate-600 hover:text-indigo-600 transition";
        tableContainer?.classList.add("hidden");
        cardsContainer?.classList.remove("hidden");
    }
    renderAll();
}

function handleSearch() {
    searchQuery = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
    renderAll();
}

function renderAll() {
    renderMonthTabs();

    const monthObj = appData.months[currentMonth] || { columns: [], members: [] };
    const columns = monthObj.columns || [];
    const allMembers = monthObj.members || [];
    const filteredMembers = searchQuery
        ? allMembers.filter((m) => m.name.toLowerCase().includes(searchQuery))
        : allMembers;

    // 計算統計數據
    let grandTotal = 0;
    const colTotals = {};
    columns.forEach((c) => {
        colTotals[c.id] = 0;
    });

    allMembers.forEach((m) => {
        columns.forEach((c) => {
            const val = Number(m.fees?.[c.id] || 0);
            colTotals[c.id] += val;
            grandTotal += val;
        });
    });

    document.getElementById("statMemberCount").textContent = allMembers.length;
    document.getElementById("statGrandTotal").textContent = `NT$ ${grandTotal.toLocaleString()}`;

    renderTableView(columns, filteredMembers, colTotals, grandTotal);
    renderCardsView(columns, filteredMembers);
}

function renderTableView(columns, members, colTotals, grandTotal) {
    const headerRow = document.getElementById("tableHeaderRow");
    const tbody = document.getElementById("tableBody");
    const tfoot = document.getElementById("tableFooter");
    if (!headerRow || !tbody || !tfoot) return;

    // 表頭
    headerRow.innerHTML = `
        <th class="sticky-col-1 bg-slate-100 py-2.5 px-2 sm:px-3 text-center w-10 sm:w-12 border-r border-slate-200">#</th>
        <th class="sticky-col-2 bg-slate-100 py-2.5 px-3 min-w-[105px] sm:min-w-[130px] border-r border-slate-200">隊員姓名</th>
        ${columns
            .map(
                (col) => `
                <th class="py-2.5 px-3 min-w-[125px] sm:min-w-[145px] border-r border-slate-200 group">
                    <div class="flex items-center justify-between gap-1">
                        <div class="flex items-center gap-1 min-w-0">
                            <span class="truncate" title="${escapeHtml(col.title)}">${escapeHtml(col.title)}</span>
                            ${
                                col.note
                                    ? `<button type="button" onclick="openNoteModal('${escapeHtml(col.id)}')" class="text-amber-500 hover:text-amber-600 shrink-0" title="檢視備註說明">
                                        <i class="fa-solid fa-circle-info"></i>
                                       </button>`
                                    : ""
                            }
                        </div>
                        ${
                            isAdmin
                                ? `<div class="flex items-center gap-1 opacity-70 group-hover:opacity-100 shrink-0">
                                    <button type="button" onclick="openEditColumnModal('${escapeHtml(col.id)}')" class="text-slate-400 hover:text-indigo-600 p-0.5" title="編輯項目">
                                        <i class="fa-solid fa-pen text-[10px]"></i>
                                    </button>
                                    <button type="button" onclick="deleteColumn('${escapeHtml(col.id)}')" class="text-slate-400 hover:text-rose-600 p-0.5" title="刪除項目">
                                        <i class="fa-solid fa-trash-can text-[10px]"></i>
                                    </button>
                                   </div>`
                                : ""
                        }
                    </div>
                </th>
            `
            )
            .join("")}
        <th class="sticky-right bg-indigo-100 text-indigo-900 py-2.5 px-3 text-right min-w-[100px] sm:min-w-[120px] border-l border-indigo-200">個人小計</th>
    `;

    // 表身
    if (members.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${columns.length + 3}" class="py-10 text-center text-slate-400 text-xs sm:text-sm">
                    目前沒有符合的隊員資料
                </td>
            </tr>
        `;
    } else {
        tbody.innerHTML = members
            .map((member, idx) => {
                let rowSum = 0;
                const cellsHtml = columns
                    .map((col) => {
                        const val = Number(member.fees?.[col.id] || 0);
                        rowSum += val;

                        if (isAdmin) {
                            return `
                                <td class="py-1.5 px-2 border-r border-slate-100 group">
                                    <div class="flex items-center justify-end gap-1">
                                        <input type="number" value="${val}"
                                            onchange="updateCellAmount('${escapeHtml(member.id)}', '${escapeHtml(col.id)}', this.value)"
                                            class="w-20 sm:w-24 px-2 py-1 text-right font-mono text-xs sm:text-sm bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-indigo-500 rounded focus:outline-none">
                                        <button type="button" onclick="copyAmount(${val})" class="text-slate-400 hover:text-indigo-600 p-1 rounded" title="複製此金額">
                                            <i class="fa-regular fa-copy text-[11px]"></i>
                                        </button>
                                        ${
                                            copiedAmount !== null
                                                ? `<button type="button" onclick="pasteAmountToCell('${escapeHtml(member.id)}', '${escapeHtml(col.id)}')" class="text-emerald-600 hover:text-emerald-700 p-1 rounded" title="貼上 NT$ ${copiedAmount}">
                                                    <i class="fa-solid fa-paste text-[11px]"></i>
                                                   </button>`
                                                : ""
                                        }
                                    </div>
                                </td>
                            `;
                        } else {
                            return `
                                <td class="py-2 px-3 text-right font-mono border-r border-slate-100 ${val > 0 ? "text-slate-700" : "text-slate-300"}">
                                    <div class="inline-flex items-center justify-end gap-1.5">
                                        <span>${val.toLocaleString()}</span>
                                        <button type="button" onclick="copyAmount(${val})" class="text-slate-300 hover:text-indigo-500 text-[10px]" title="複製金額">
                                            <i class="fa-regular fa-copy"></i>
                                        </button>
                                    </div>
                                </td>
                            `;
                        }
                    })
                    .join("");

                return `
                    <tr class="hover:bg-indigo-50/30 transition">
                        <td class="sticky-col-1 bg-white py-2 px-2 text-center text-slate-400 font-mono border-r border-slate-100">${idx + 1}</td>
                        <td class="sticky-col-2 bg-white py-2 px-3 font-semibold text-slate-800 border-r border-slate-200">
                            <div class="flex items-center justify-between gap-1">
                                <span class="truncate">${escapeHtml(member.name)}</span>
                                ${
                                    isAdmin
                                        ? `<button type="button" onclick="openEditMemberModal('${escapeHtml(member.id)}')" class="text-slate-400 hover:text-indigo-600 p-0.5 shrink-0" title="編輯成員">
                                            <i class="fa-solid fa-user-pen text-[11px]"></i>
                                           </button>`
                                        : ""
                                }
                            </div>
                        </td>
                        ${cellsHtml}
                        <td class="sticky-right bg-indigo-50/70 py-2 px-3 text-right font-mono font-bold text-indigo-700 border-l border-indigo-100">
                            NT$ ${rowSum.toLocaleString()}
                        </td>
                    </tr>
                `;
            })
            .join("");
    }

    // 表尾合計列
    tfoot.innerHTML = `
        <tr>
            <td class="sticky-col-1 bg-indigo-50 py-2.5 px-2 text-center border-r border-indigo-200">—</td>
            <td class="sticky-col-2 bg-indigo-50 py-2.5 px-3 border-r border-indigo-200">項目總計</td>
            ${columns
                .map(
                    (col) => `
                    <td class="py-2.5 px-3 text-right font-mono border-r border-indigo-200">
                        ${(colTotals[col.id] || 0).toLocaleString()}
                    </td>
                `
                )
                .join("")}
            <td class="sticky-right bg-indigo-100 text-indigo-950 py-2.5 px-3 text-right font-mono border-l border-indigo-200">
                NT$ ${grandTotal.toLocaleString()}
            </td>
        </tr>
    `;
}

function renderCardsView(columns, members) {
    const container = document.getElementById("cardsViewContainer");
    if (!container) return;

    if (members.length === 0) {
        container.innerHTML = `<div class="col-span-full py-10 text-center text-slate-400 text-sm bg-white rounded-xl border border-slate-200">目前沒有符合的隊員資料</div>`;
        return;
    }

    container.innerHTML = members
        .map((member) => {
            const total = columns.reduce((sum, c) => sum + (Number(member.fees?.[c.id]) || 0), 0);
            const itemsHtml = columns
                .map((col) => {
                    const val = Number(member.fees?.[col.id] || 0);
                    return `
                        <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-b-0">
                            <span class="text-slate-600 truncate pr-2">${escapeHtml(col.title)}</span>
                            <span class="font-mono font-medium ${val > 0 ? "text-slate-800" : "text-slate-300"}">
                                NT$ ${val.toLocaleString()}
                            </span>
                        </div>
                    `;
                })
                .join("");

            return `
                <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between gap-3">
                    <div>
                        <div class="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                            <h4 class="font-bold text-slate-800 text-sm sm:text-base">${escapeHtml(member.name)}</h4>
                            <span class="text-xs font-bold font-mono bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-md">
                                NT$ ${total.toLocaleString()}
                            </span>
                        </div>
                        <div class="space-y-0.5">${itemsHtml}</div>
                    </div>
                    ${
                        isAdmin
                            ? `<div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                                <button type="button" onclick="openEditMemberModal('${escapeHtml(member.id)}')" class="text-xs text-slate-500 hover:text-indigo-600 px-2 py-1">
                                    <i class="fa-solid fa-user-pen mr-1"></i>姓名
                                </button>
                                <button type="button" onclick="openMobileEditModal('${escapeHtml(member.id)}')" class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-medium">
                                    <i class="fa-solid fa-pen-to-square mr-1"></i>編輯金額
                                </button>
                               </div>`
                            : ""
                    }
                </div>
            `;
        })
        .join("");
}

// ==========================================
// 11. Excel 多分頁匯入與匯出 (SheetJS)
// ==========================================
function triggerExcelImport() {
    if (!isAdmin) return;
    const input = document.getElementById("excelFileInput");
    if (input) {
        input.value = "";
        input.click();
    }
}

function handleExcelImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            pendingWorkbook = XLSX.read(data, { type: "array" });

            if (!pendingWorkbook.SheetNames || pendingWorkbook.SheetNames.length === 0) {
                showToast("Excel 檔案中找不到任何工作表", "error");
                return;
            }

            document.getElementById("targetImportMonthLabel").textContent = currentMonth;
            const listEl = document.getElementById("excelSheetList");
            listEl.innerHTML = pendingWorkbook.SheetNames.map(
                (name, idx) => `
                <label class="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 hover:bg-indigo-50/40 cursor-pointer">
                    <input type="radio" name="excelSheetRadio" value="${escapeHtml(name)}" ${idx === 0 ? "checked" : ""} class="text-indigo-600 focus:ring-indigo-500">
                    <span class="text-xs sm:text-sm font-medium text-slate-700">${escapeHtml(name)}</span>
                </label>
            `
            ).join("");

            document.getElementById("excelSheetModal")?.classList.remove("hidden");
        } catch (err) {
            console.error("解析 Excel 失敗:", err);
            showToast("無法解析此 Excel 檔案", "error");
        }
    };
    reader.readAsArrayBuffer(file);
}

function closeExcelSheetModal() {
    document.getElementById("excelSheetModal")?.classList.add("hidden");
}

function confirmImportSelectedSheet() {
    const checked = document.querySelector('input[name="excelSheetRadio"]:checked');
    if (!checked) {
        showToast("請選擇一個工作表", "warn");
        return;
    }
    selectedSheetName = checked.value;
    closeExcelSheetModal();

    document.getElementById("importOptionSheetName").textContent = selectedSheetName;
    document.getElementById("importOptionMonthName").textContent = currentMonth;
    document.querySelectorAll(".importOptionMonthText").forEach((el) => {
        el.textContent = currentMonth;
    });

    document.getElementById("importOptionModal")?.classList.remove("hidden");
}

function closeImportOptionModal() {
    document.getElementById("importOptionModal")?.classList.add("hidden");
}

async function executeImportWithMode() {
    if (!pendingWorkbook || !selectedSheetName) return;

    const mode = document.querySelector('input[name="importModeRadio"]:checked')?.value || "merge";
    const sheet = pendingWorkbook.Sheets[selectedSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (!rows || rows.length < 2) {
        showToast("工作表內容為空或格式不符", "error");
        closeImportOptionModal();
        return;
    }

    // 解析標題列：尋找「姓名」欄位，並排除「編號 / 序號 / 小計 / 總計」
    const headerRow = rows[0].map((cell) => String(cell).trim());
    let nameColIdx = headerRow.findIndex((h) => h.includes("姓名") || h === "隊員" || h === "名字");
    if (nameColIdx === -1) nameColIdx = headerRow.length > 1 ? 1 : 0;

    const ignoreHeaders = ["#", "編號", "序號", "個人小計", "小計", "總計", "合計"];
    const feeColsMeta = [];
    headerRow.forEach((h, idx) => {
        if (idx === nameColIdx || !h) return;
        if (ignoreHeaders.some((ig) => h === ig)) return;
        feeColsMeta.push({ colIdx: idx, title: h });
    });

    const targetMonth = appData.months[currentMonth];

    if (mode === "replace") {
        const newColumns = feeColsMeta.map((fc) => ({
            id: generateId("col"),
            title: fc.title,
            note: ""
        }));

        const newMembers = [];
        for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            const memberName = String(row[nameColIdx] || "").trim();
            if (!memberName || memberName === "項目總計" || memberName === "總計") continue;

            const fees = {};
            feeColsMeta.forEach((fc, i) => {
                const rawNum = parseFloat(String(row[fc.colIdx]).replace(/,/g, ""));
                fees[newColumns[i].id] = isNaN(rawNum) ? 0 : rawNum;
            });

            newMembers.push({
                id: generateId("mem"),
                name: memberName,
                fees
            });
        }

        appData.months[currentMonth] = {
            columns: newColumns,
            members: newMembers
        };
    } else {
        // 合併 / 更新模式
        const titleToColId = {};
        targetMonth.columns.forEach((c) => {
            titleToColId[c.title] = c.id;
        });

        feeColsMeta.forEach((fc) => {
            if (!titleToColId[fc.title]) {
                const newId = generateId("col");
                targetMonth.columns.push({ id: newId, title: fc.title, note: "" });
                titleToColId[fc.title] = newId;
            }
        });

        for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            const memberName = String(row[nameColIdx] || "").trim();
            if (!memberName || memberName === "項目總計" || memberName === "總計") continue;

            let member = targetMonth.members.find((m) => m.name === memberName);
            if (!member) {
                member = { id: generateId("mem"), name: memberName, fees: {} };
                targetMonth.members.push(member);
            }
            if (!member.fees) member.fees = {};

            feeColsMeta.forEach((fc) => {
                const cId = titleToColId[fc.title];
                const rawNum = parseFloat(String(row[fc.colIdx]).replace(/,/g, ""));
                if (!isNaN(rawNum)) {
                    member.fees[cId] = rawNum;
                }
            });
        }
    }

    closeImportOptionModal();
    pendingWorkbook = null;
    await saveData();
    showToast(`已成功匯入「${selectedSheetName}」資料`);
}

function exportToExcel() {
    if (!isAdmin) return;
    if (typeof XLSX === "undefined") {
        showToast("Excel 匯出元件尚未載入完成", "error");
        return;
    }

    const wb = XLSX.utils.book_new();

    appData.monthOrder.forEach((monthName) => {
        const mObj = appData.months[monthName];
        if (!mObj) return;

        const cols = mObj.columns || [];
        const members = mObj.members || [];

        const aoa = [];
        aoa.push(["編號", "隊員姓名", ...cols.map((c) => c.title), "個人小計"]);

        const colSums = new Array(cols.length).fill(0);
        let totalSum = 0;

        members.forEach((m, idx) => {
            let rowTotal = 0;
            const feeVals = cols.map((c, cIdx) => {
                const v = Number(m.fees?.[c.id] || 0);
                rowTotal += v;
                colSums[cIdx] += v;
                return v;
            });
            totalSum += rowTotal;
            aoa.push([idx + 1, m.name, ...feeVals, rowTotal]);
        });

        aoa.push(["", "項目總計", ...colSums, totalSum]);

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const safeSheetName = monthName.replace(/[\\/?*[\]]/g, "_").substring(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, safeSheetName || "Sheet1");
    });

    XLSX.writeFile(wb, `團隊費用統計報表_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast("已匯出多分頁 Excel 報表");
}

// ==========================================
// 12. 系統初始化與全域函式掛載
// ==========================================
function initApp() {
    // 啟動頂部資訊列（新豐鄉天氣、台股大盤、台灣熱門新聞跑馬燈）
    fetchXinfengWeather(false, showToast);
    fetchTaiwanStockIndex(false, showToast);
    fetchTaiwanHotNews(false, showToast);

    // 初始化資料與管理者介面狀態
    initFirebaseAndData();
    updateAdminUI();
}

Object.assign(window, {
    // 頂部小工具重整
    fetchXinfengWeather: (isManual) => fetchXinfengWeather(isManual, showToast),
    fetchTaiwanStockIndex: (isManual) => fetchTaiwanStockIndex(isManual, showToast),
    fetchTaiwanHotNews: (isManual) => fetchTaiwanHotNews(isManual, showToast),

    // 管理者驗證
    handleAdminBtnClick,
    closeAdminModal,
    checkAdminPassword,

    // 月份分頁
    selectMonth,
    openAddMonthModal,
    closeMonthModal,
    toggleSelectAllMonthCols,
    saveNewMonth,
    openEditMonthModal,
    closeEditMonthModal,
    saveEditedMonthName,
    deleteMonth,

    // 費用項目欄位
    openAddColumnModal,
    openEditColumnModal,
    closeColumnModal,
    saveColumn,
    deleteColumn,
    openNoteModal,
    closeNoteModal,

    // 隊員管理
    openAddMemberModal,
    openEditMemberModal,
    closeMemberModal,
    saveMember,
    deleteMemberFromModal,

    // 金額操作與批次貼上
    updateCellAmount,
    copyAmount,
    clearCopiedAmount,
    pasteAmountToCell,
    openBatchPasteModal,
    closeBatchPasteModal,
    toggleSelectAllBatchMembers,
    applyBatchPaste,

    // 行動版編輯
    openMobileEditModal,
    handleMobileFeeChange,
    pasteInMobileModal,
    closeMobileEditModal,

    // 檢視與搜尋
    switchViewMode,
    handleSearch,

    // Excel 匯入與匯出
    triggerExcelImport,
    handleExcelImport,
    closeExcelSheetModal,
    confirmImportSelectedSheet,
    closeImportOptionModal,
    executeImportWithMode,
    exportToExcel
});

document.addEventListener("DOMContentLoaded", initApp);