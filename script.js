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
