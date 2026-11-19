import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==========================================
// Firebase 集中配置（供全站模組共用）
// ==========================================
export const firebaseConfig = {
    apiKey: "AIzaSyDIcgwxG4eGVg_g3iQrAnHvGpVc0WFU3J0",
    authDomain: "expense-ddcfe.firebaseapp.com",
    projectId: "expense-ddcfe",
    storageBucket: "expense-ddcfe.firebasestorage.app",
    messagingSenderId: "457060907844",
    appId: "1:457060907844:web:1574ec3ffa204cd4383511"
};

// 初始化 Firebase & Firestore 實例
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// 共用 Firestore 文件參照（沿用現有資料路徑）
export const dataDocRef = doc(db, "expenseTracker", "mainData");
export const adminDocRef = doc(db, "config", "admin");

// 預設常數設定
export const DEFAULT_MONTH_KEY = "2026年11月";

export const INITIAL_COLUMNS = [
    { id: "col_1", title: "十一月隊費", note: "月度例行隊費支出" },
    { id: "col_2", title: "課後班費用", note: "課後訓練加強班指導費用" },
    { id: "col_3", title: "對抗賽 (新竹市站) 餐費", note: "比賽當天選手與教練團餐盒" },
    { id: "col_4", title: "縣長盃代訂餐費", note: "大會代訂午餐便當" },
    { id: "col_5", title: "後援會服", note: "隊員及家長新版後援會隊服訂製" },
    { id: "col_6", title: "夜訓餐費", note: "夜間集訓晚點心與餐食補給" },
    { id: "col_7", title: "會長盃住宿費", note: "會長盃全國賽飯店兩晚住宿費" },
    { id: "col_8", title: "摩亞盃住宿費", note: "摩亞盃住宿費與遊覽車車資分攤" },
    { id: "col_9", title: "協助球隊購買支出於隊費直接折抵", note: "家長先行墊付隊伍物資之折抵金額（為負數）" },
    { id: "col_10", title: "10月份個練費用", note: "十月份個人專項訓練課程費用" }
];

// 隊員姓名與金額資訊完全由 Firestore 雲端資料庫讀取，不寫死於前端程式碼中
export const INITIAL_MEMBERS = [];