const floors = [
  { floor: "8F", urgency: 92, rooms: 12, nights: 876, available: "05/15 可封層" },
  { floor: "6F", urgency: 81, rooms: 9, nights: 642, available: "05/17 可封層" },
  { floor: "5F", urgency: 68, rooms: 7, nights: 511, available: "待前台確認" },
  { floor: "3F", urgency: 44, rooms: 4, nights: 298, available: "未達門檻" }
];

const rooms = [
  { no: "801", nights: 94, priority: 96, date: "2026-01-12", status: "建議" },
  { no: "803", nights: 90, priority: 92, date: "2026-01-20", status: "建議" },
  { no: "805", nights: 86, priority: 88, date: "2026-01-28", status: "建議" },
  { no: "806", nights: 82, priority: 84, date: "2026-02-04", status: "建議" },
  { no: "808", nights: 78, priority: 79, date: "2026-02-10", status: "可排入" },
  { no: "810", nights: 71, priority: 73, date: "2026-02-16", status: "可排入" },
  { no: "812", nights: 66, priority: 66, date: "2026-02-22", status: "觀察" },
  { no: "816", nights: 61, priority: 60, date: "2026-03-01", status: "觀察" }
];

const floorList = document.querySelector("#floorList");
const roomRows = document.querySelector("#roomRows");
const priorityList = document.querySelector("#priorityList");
const recordList = document.querySelector("#recordList");
const lastRoomSelect = document.querySelector("#lastRoomSelect");

floorList.innerHTML = floors.map((item, index) => `
  <button class="floor-card ${index === 0 ? "active" : ""}" type="button">
    <span class="floor-badge">${item.floor}</span>
    <span>
      <strong>${item.rooms} 間建議翻床</strong>
      <small>累計 ${item.nights} 晚 · ${item.available}</small>
    </span>
    <span class="urgency">${item.urgency}</span>
  </button>
`).join("");

roomRows.innerHTML = rooms.map(room => `
  <tr>
    <td><strong>${room.no}</strong></td>
    <td>${room.nights} 晚</td>
    <td>
      <div class="bar">
        <span><i style="width:${room.priority}%"></i></span>
        ${room.priority}
      </div>
    </td>
    <td>${room.date}</td>
    <td><span class="status-pill ${room.status === "建議" ? "danger" : ""}">${room.status}</span></td>
  </tr>
`).join("");

priorityList.innerHTML = rooms.slice(0, 6).map(room => `
  <li>
    <strong>${room.no} · 優先級 ${room.priority}</strong>
    <span>累計入住 ${room.nights} 晚，上次翻床 ${room.date}</span>
  </li>
`).join("");

function renderRecordList(lastRoom = "808") {
  const lastIndex = rooms.findIndex(room => room.no === lastRoom);
  recordList.innerHTML = rooms.map((room, index) => `
    <label>
      <input type="checkbox" ${index <= lastIndex ? "checked" : ""}>
      ${room.no} · ${room.nights} 晚
    </label>
  `).join("");
}

lastRoomSelect.addEventListener("change", event => {
  renderRecordList(event.target.value);
});

renderRecordList();

/* ===================================================
   F1.1 門檻設定互動邏輯
   =================================================== */

// 各房型獨立儲存門檻值
const thresholdData = {
  single: { can: 60, rec: 120, urg: 180 },
  double: { can: 70, rec: 130, urg: 190 },
  quad:   { can: 80, rec: 140, urg: 200 },
  suite:  { can: 90, rec: 150, urg: 210 }
};
let currentTab = "single";

const inputCan = document.getElementById("thresh_can");
const inputRec = document.getElementById("thresh_rec");
const inputUrg = document.getElementById("thresh_urg");

function loadTabData(tab) {
  const d = thresholdData[tab];
  inputCan.value = d.can;
  inputRec.value = d.rec;
  inputUrg.value = d.urg;
}

function saveTabData(tab) {
  thresholdData[tab] = {
    can: Number(inputCan.value),
    rec: Number(inputRec.value),
    urg: Number(inputUrg.value)
  };
}

// 房型 tab 切換
document.querySelectorAll(".room-type-tabs .chip").forEach(btn => {
  btn.addEventListener("click", () => {
    saveTabData(currentTab);
    document.querySelectorAll(".room-type-tabs .chip").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    loadTabData(currentTab);
  });
});

// 紅燈權重即時同步至公式預覽
const redWeightInput = document.getElementById("thresh_red_weight");
const weightPreview  = document.getElementById("weight_preview");
if (redWeightInput && weightPreview) {
  redWeightInput.addEventListener("input", () => {
    weightPreview.textContent = redWeightInput.value;
  });
}

// Toast 提示工具函式
function showToast(msg) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2800);
}

// 儲存設定按鈕
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener("click", () => {
    saveTabData(currentTab);
    showToast("✓ 門檻設定已儲存");
  });
}

/* ===================================================
   F4.1/F4.2 AI 建議互動邏輯
   =================================================== */

// 套用 AI 建議：將建議值填入門檻設定並記錄
document.querySelectorAll(".ai-accept-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const field = btn.dataset.field;
    const value = Number(btn.dataset.value);
    const roomType = btn.dataset.roomType;
    const authMode = document.querySelector('input[name="ai_auth"]:checked').value;

    // 填入對應欄位
    const fieldMap = {
      thresh_can: inputCan,
      thresh_rec: inputRec,
      thresh_urg: inputUrg,
      thresh_red_weight: redWeightInput
    };
    if (fieldMap[field]) {
      // 切換到對應房型 tab（若有）
      if (roomType) {
        const tabBtn = document.querySelector(`.room-type-tabs [data-tab="${roomType}"]`);
        if (tabBtn) {
          saveTabData(currentTab);
          document.querySelectorAll(".room-type-tabs .chip").forEach(b => b.classList.remove("active"));
          tabBtn.classList.add("active");
          currentTab = roomType;
          loadTabData(currentTab);
        }
      }
      fieldMap[field].value = value;
      if (field === "thresh_red_weight" && weightPreview) {
        weightPreview.textContent = value;
      }
      saveTabData(currentTab);
    }

    // 新增調整紀錄
    const logEl = document.getElementById("aiAdjLog");
    if (logEl) {
      const labelMap = {
        thresh_can: "可以翻床門檻",
        thresh_rec: "建議翻床門檻",
        thresh_urg: "急需翻床門檻",
        thresh_red_weight: "紅燈房權重"
      };
      const roomTypeLabel = { single:"單人房", double:"雙人房", quad:"四人房", suite:"套房" };
      const typeStr = roomType ? `${roomTypeLabel[roomType]} ` : "";
      const modeStr = authMode === "auto" ? "AI 自動套用" : "AI 建議，手動套用";
      const today = new Date().toISOString().slice(0, 10);
      const entry = document.createElement("div");
      entry.innerHTML = `<span></span><strong>${typeStr}${labelMap[field]} 已調整為 ${value}</strong><small>${modeStr} · ${today}</small>`;
      logEl.prepend(entry);
    }

    // 卡片標示已套用
    const card = btn.closest(".ai-card");
    if (card) {
      btn.textContent = "✓ 已套用";
      btn.disabled = true;
      btn.style.opacity = "0.7";
    }

    showToast("✓ AI 建議已套用至門檻設定");
  });
});

// 授權模式切換顯示文字
document.querySelectorAll('input[name="ai_auth"]').forEach(radio => {
  radio.addEventListener("change", () => {
    const label = document.getElementById("authModeLabel");
    if (label) {
      label.textContent = radio.value === "auto" ? "授權 AI 自動調整" : "手動確認";
    }
  });
});

// 重新分析按鈕動畫
const refreshAiBtn = document.getElementById("refreshAiBtn");
if (refreshAiBtn) {
  refreshAiBtn.addEventListener("click", () => {
    refreshAiBtn.textContent = "分析中…";
    refreshAiBtn.disabled = true;
    setTimeout(() => {
      refreshAiBtn.textContent = "重新分析";
      refreshAiBtn.disabled = false;
      showToast("✓ AI 分析已完成，建議已更新");
    }, 1800);
  });
}

