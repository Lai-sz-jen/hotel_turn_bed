/**
 * 智慧翻床統籌系統 - 前端核心邏輯 (API 對接架構)
 * 嚴格遵循 SA 文件定義之 JSON 格式進行資料拋接
 */

// ==========================================
// 1. 模擬後端 (Mock Backend)
// ==========================================
class MockBackend {
    constructor() {
        this.db = {
            thresholds: {
                single: { can: 60, rec: 120, urg: 180 },
                twin: { can: 70, rec: 130, urg: 190 },
                double: { can: 70, rec: 130, urg: 190 },
                quad: { can: 80, rec: 140, urg: 200 }
            },
            weights: { minYellow: 5, redWeight: 2 },
            rooms: [],
            plans: [],
            exceptions: []
        };
        this.initMockData();
    }

    initMockData() {
        const floors = ['2', '3', '5', '6', '8', '9', 'B1'];
        const typesMap = ['single', 'twin', 'double', 'quad'];
        
        let roomId = 1;
        floors.forEach(floor => {
            for (let i = 1; i <= 15; i++) {
                let no = floor === 'B1' ? `B10${i}` : `${floor}${i.toString().padStart(2, '0')}`;
                let typeIdx = Math.floor(Math.random() * 4);
                let nights = Math.floor(Math.random() * 210);
                
                let date = new Date();
                date.setDate(date.getDate() - nights);

                this.db.rooms.push({
                    no: no,
                    floor: floor,
                    type: typesMap[typeIdx], // SA1 中可能為 '單人房' 等，此處為了配合部分 API 設計用英文鍵值，前端再轉換
                    nights: nights,
                    last_turned: date.toISOString(),
                    status: 'GREEN', // 計算後更新
                    priorityScore: 0
                });
            }
        });

        this.db.plans.push({
            id: '1',
            floor: "6",
            date: "2026-06-21",
            confirmed: true,
            rooms: ["601", "602", "603"]
        });

        this.recalculateAll();
    }

    recalculateAll() {
        // 更新房間燈號與優先度
        this.db.rooms.forEach(room => {
            const t = this.db.thresholds[room.type];
            let light = 'GREEN';
            if (room.nights >= t.urg) light = 'RED';
            else if (room.nights >= t.rec) light = 'YELLOW';
            else if (room.nights >= t.can) light = 'BLUE';

            room.status = light;
            room.priorityScore = room.nights / t.rec;
        });
    }

    getRoomTypeZH(typeEN) {
        const m = { 'single': '單人房', 'double': '雙人房', 'twin': '雙人房', 'quad': '四人房' };
        return m[typeEN] || typeEN;
    }

    // --- API 路由處理 ---
    
    // 1.0 GET /dashboard
    getDashboard() {
        return this.db.rooms.map(r => ({
            no: r.no,
            nights: r.nights,
            date: r.last_turned.split('T')[0],
            status: r.status
        }));
    }

    // 2.0 POST /dashboard/search
    searchDashboard(payload) {
        let filtered = this.db.rooms;
        const filters = payload.filters || {};
        
        if (filters.floors && filters.floors.length > 0) {
            filtered = filtered.filter(r => filters.floors.includes(r.floor));
        }
        if (filters.room_types && filters.room_types.length > 0) {
            filtered = filtered.filter(r => filters.room_types.includes(r.type));
        }
        if (filters.room_no) {
            filtered = filtered.filter(r => r.no.includes(filters.room_no));
        }
        if (filters.statuses && filters.statuses.length > 0) {
            filtered = filtered.filter(r => filters.statuses.includes(r.status));
        }

        // Apply sort
        const sign = payload.sort_order === 'desc' ? -1 : 1;
        
        if (payload.sort_by === 'floor') {
            filtered.sort((a, b) => {
                const getFloorNum = (f) => f.startsWith('B') ? -parseInt(f.substring(1)) : parseInt(f);
                const fa = getFloorNum(a.floor);
                const fb = getFloorNum(b.floor);
                if (fa !== fb) return (fa - fb) * sign;
                return a.no.localeCompare(b.no) * sign;
            });
        } else {
            const sortField = payload.sort_by === 'nights' ? 'nights' : 'no';
            filtered.sort((a, b) => {
                if (a[sortField] < b[sortField]) return -1 * sign;
                if (a[sortField] > b[sortField]) return 1 * sign;
                return 0;
            });
        }

        // Mapping to requested output structure (SA1 FE-01-2)
        // 雖然 SA2 寫陣列，但 SA1 寫 {"rooms": [...]}，此處混合提供
        return filtered.map(r => ({
            no: r.no,
            room: r.no, // FE-01-2 相容
            type: this.getRoomTypeZH(r.type), // FE-01-2 相容
            light: r.status.toLowerCase(), // FE-01-2 相容
            last_turned: r.last_turned, // FE-01-2 相容
            nights: r.nights,
            date: r.last_turned.split('T')[0],
            status: r.status
        }));
    }

    // 3.0 GET /dashboard/export
    exportDashboard() {
        return {
            status: "success",
            path: "/path/to/report",
            file: `report_${new Date().getTime()}.csv`
        };
    }

    // 4.0 GET /plans/suggestion (含 SA1 FE-01-1 的複雜格式)
    getPlanSuggestion() {
        const floorMap = {};
        this.db.rooms.forEach(r => {
            if (!floorMap[r.floor]) {
                floorMap[r.floor] = { floor: r.floor, total: 0, sumW: 0, blue_and_above: 0, yellow_and_above: 0 };
            }
            const f = floorMap[r.floor];
            f.total++;
            let w_i = 0;
            if (r.status === 'YELLOW') {
                w_i = 1; f.yellow_and_above++; f.blue_and_above++;
            } else if (r.status === 'RED') {
                w_i = this.db.weights.redWeight; f.yellow_and_above++; f.blue_and_above++;
            } else if (r.status === 'BLUE') {
                f.blue_and_above++;
            }
            f.sumW += (w_i * r.priorityScore);
        });

        const floors = Object.values(floorMap).map(f => {
            return {
                floor: f.floor,
                score: f.total > 0 ? (f.sumW / f.total) * 100 : 0,
                blue_and_above: f.blue_and_above,
                yellow_and_above: f.yellow_and_above
            };
        }).filter(f => f.yellow_and_above >= this.db.weights.minYellow)
          .sort((a, b) => b.score - a.score);

        return {
            suggested_floors: floors,
            suggestion: floors.length > 0 ? floors[0].floor : null
        };
    }

    // 5.0 POST /plans
    createPlan(payload) {
        this.db.plans.push({
            id: Date.now().toString(),
            floor: payload.floor,
            date: payload.date,
            confirmed: payload.confirmed,
            rooms: payload.rooms
        });
        return { status: "success" };
    }

    // 6.0 PATCH /plans/<id>
    updatePlan(id, payload) {
        const turnedRooms = payload.turned || [];
        this.db.rooms.forEach(r => {
            if (turnedRooms.includes(r.no)) {
                r.nights = 0;
                r.last_turned = new Date().toISOString();
            }
        });
        // 刪除已完成的計畫
        this.db.plans = this.db.plans.filter(p => p.id !== id);
        this.recalculateAll();
        return { status: "success" };
    }

    // 7.0 POST /exceptions
    createException(payload) {
        const room = this.db.rooms.find(r => r.no === payload.room_no);
        if (room) {
            this.db.exceptions.push({
                date: new Date().toISOString().split('T')[0],
                room: room.no,
                type: this.getRoomTypeZH(room.type),
                light: room.status.toLowerCase(),
                night: room.nights
            });
            return { status: "success" };
        }
        return { status: "error", message: "Room not found" };
    }

    // 8.0 GET /exceptions
    getExceptions() {
        return { rooms: [...this.db.exceptions].reverse() };
    }

    // 9.0 PUT /parameters
    updateParameters(payload) {
        if (payload.single !== undefined) this.db.thresholds.single.rec = payload.single;
        if (payload.twin !== undefined) this.db.thresholds.twin.rec = payload.twin;
        if (payload.double !== undefined) this.db.thresholds.double.rec = payload.double;
        if (payload.quad !== undefined) this.db.thresholds.quad.rec = payload.quad;
        this.recalculateAll();
        return { status: "success" };
    }

    // 10.0 GET /parameters/suggestion
    getParameterSuggestion() {
        return {
            status: 'success',
            suggestions: [
                { type: '四人房', old_val: 140, new_val: 120, reason: '近期四人房翻床超時比例增加 15%，建議調降黃燈門檻以提早排程。' }
            ]
        };
    }

    // 11.0 PUT /parameters/authorize
    authorizeParameters(payload) {
        return { status: "success" };
    }

    // 12.0 POST /notices/config
    updateNotices(payload) {
        return { status: "success" };
    }
    // 9.0 PUT /parameters
    async updateParameters(payload) {
        // payload expects: { single: {can, rec, urg}, twin: {can, rec, urg}, ... }
        if (payload.single) this.db.thresholds.single = { ...this.db.thresholds.single, ...payload.single };
        if (payload.twin) this.db.thresholds.twin = { ...this.db.thresholds.twin, ...payload.twin };
        if (payload.double) this.db.thresholds.double = { ...this.db.thresholds.double, ...payload.double };
        if (payload.quad) this.db.thresholds.quad = { ...this.db.thresholds.quad, ...payload.quad };
        this.recalculateAll();
        return { status: 'success', updated_parameters: this.db.thresholds };
    }
}

// ==========================================
// 2. API Client 介面
// ==========================================
const mockBackend = new MockBackend();

const apiClient = {
    async request(method, endpoint, payload = {}) {
        try {
            console.log(`[API Request] ${method} ${endpoint}`, payload);
            
            // 模擬網路延遲
            await new Promise(resolve => setTimeout(resolve, 300));
            
            let response;
            if (endpoint === '/dashboard' && method === 'GET') {
                response = { status: 'success', rooms: mockBackend.getDashboard() };
            } else if (endpoint === '/dashboard/search' && method === 'POST') {
                response = mockBackend.searchDashboard(payload);
            } else if (endpoint === '/dashboard/export' && method === 'GET') {
                response = mockBackend.exportDashboard();
            } else if (endpoint === '/plans/suggestion' && method === 'GET') {
                response = mockBackend.getPlanSuggestion();
            } else if (endpoint === '/plans' && method === 'POST') {
                response = mockBackend.createPlan(payload);
            } else if (endpoint.startsWith('/plans/') && method === 'PATCH') {
                const id = endpoint.split('/')[2];
                response = mockBackend.updatePlan(id, payload);
            } else if (endpoint === '/exceptions' && method === 'POST') {
                response = mockBackend.createException(payload);
            } else if (endpoint === '/exceptions' && method === 'GET') {
                response = mockBackend.getExceptions();
            } else if (endpoint === '/parameters' && method === 'GET') {
                return new Promise(resolve => setTimeout(() => {
                    resolve({ status: 'success', parameters: mockBackend.db.thresholds });
                }, 100));
            } else if (endpoint === '/parameters' && method === 'PUT') {
                response = await mockBackend.updateParameters(payload);
            } else if (endpoint === '/parameters/suggestion' && method === 'GET') {
                response = mockBackend.getParameterSuggestion();
            } else if (endpoint === '/parameters/authorize' && method === 'PUT') {
                response = mockBackend.authorizeParameters(payload);
            } else if (endpoint === '/notices/config' && method === 'POST') {
                response = mockBackend.updateNotices(payload);
            } else {
                throw new Error('404 Not Found');
            }
            
            console.log(`[API Response]`, response);
            return response;
        } catch (error) {
            console.error(`[API Error]`, error);
            throw error;
        }
    }
};

// ==========================================
// 3. 視圖控制器 (View Controllers)
// ==========================================

const ViewControllers = {
    // 取得指定燈號的 HTML 標籤
    getLightBadge(lightStr) {
        const map = {
            'red': '<span class="status-pill pill-red"><span class="dot dot-red"></span>急需</span>',
            'yellow': '<span class="status-pill pill-yellow"><span class="dot dot-yellow"></span>建議</span>',
            'blue': '<span class="status-pill pill-blue"><span class="dot dot-blue"></span>可排</span>',
            'green': '<span class="status-pill pill-green"><span class="dot dot-green"></span>無須</span>'
        };
        return map[lightStr.toLowerCase()] || lightStr;
    },

    // 重新載入儀表板資料
    async loadDashboard() {
        const floorFilter = document.getElementById('filter-floor').value;
        const typeFilter = document.getElementById('filter-type').value;
        const lightFilter = document.getElementById('filter-light').value;
        const noFilter = document.getElementById('filter-room-no').value;

        // API 呼叫：取得真實儀表板與建議樓層資料
        let data;
        try {
            const res = await fetch('/api/v1/dashboard/summary');
            if (!res.ok) throw new Error('Network response was not ok');
            data = await res.json();
        } catch (e) {
            console.error(e);
            document.getElementById('room-grid-container').innerHTML = `<div class="empty-state">無法連線至後端伺服器</div>`;
            return;
        }

        const planData = { suggested_floors: data.suggested_floors };
        let rooms = data.rooms;

        // 動態從真實資料庫房間列表中產生樓層篩選器選項
        const filterFloor = document.getElementById('filter-floor');
        if (filterFloor) {
            const selectedVal = filterFloor.value;
            const floorsSet = new Set(rooms.map(r => r.floor));
            const getFloorNum = (f) => f.startsWith('B') ? -parseInt(f.substring(1)) : parseInt(f);
            const sortedFloors = Array.from(floorsSet).sort((a, b) => getFloorNum(a) - getFloorNum(b));
            
            // 清除現有動態產生之樓層 (保留前 3 個預設選項)
            while (filterFloor.options.length > 3) {
                filterFloor.remove(3);
            }
            
            sortedFloors.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = `${f} 樓`;
                filterFloor.appendChild(opt);
            });
            filterFloor.value = selectedVal;
        }

        // 本地篩選邏輯
        if (floorFilter === '@eligible') {
            const eligFloors = data.suggested_floors.map(f => f.floor);
            rooms = rooms.filter(r => eligFloors.includes(r.floor));
        } else if (floorFilter === '@ineligible') {
            const eligFloors = data.suggested_floors.map(f => f.floor);
            rooms = rooms.filter(r => !eligFloors.includes(r.floor));
        } else if (floorFilter) {
            rooms = rooms.filter(r => r.floor === floorFilter);
        }

        if (typeFilter) {
            rooms = rooms.filter(r => r.type === typeFilter);
        }
        if (noFilter) {
            rooms = rooms.filter(r => r.room.includes(noFilter));
        }
        if (lightFilter) {
            rooms = rooms.filter(r => r.light.toLowerCase() === lightFilter.toLowerCase());
        }
        
        // 確保與舊版渲染程式碼相容：將 backend 的 `room` 映射回 `no`，`light` 映射為 `status`
        rooms = rooms.map(r => ({
            ...r,
            no: r.room,
            status: r.light.toUpperCase()
        }));

        // 渲染 Top Cards
        if (planData.suggested_floors && planData.suggested_floors.length > 0) {
            const top = planData.suggested_floors[0];
            document.getElementById('dash-urgent-floor').textContent = top.floor;
            document.getElementById('dash-urgent-score').textContent = `得分 ${top.score.toFixed(1)} / 達標 ${top.yellow_and_above}間`;
        } else {
            document.getElementById('dash-urgent-floor').textContent = '--';
            document.getElementById('dash-urgent-score').textContent = '目前無樓層達標';
        }

        // 渲染列表 (合併排行與總覽)
        const gridContainer = document.getElementById('room-grid-container');
        if (rooms.length === 0) {
            gridContainer.innerHTML = `<div class="empty-state">找不到符合條件的客房</div>`;
        } else {
            // Group rooms by floor
            const floorGroups = {};
            rooms.forEach(r => {
                const floor = r.no.replace(/\d{2}$/, ''); 
                if (!floorGroups[floor]) floorGroups[floor] = [];
                floorGroups[floor].push(r);
            });

            // Map scores from planData
            const scoreMap = {};
            if (planData.suggested_floors) {
                planData.suggested_floors.forEach((f, idx) => {
                    scoreMap[f.floor] = { rank: idx + 1, score: f.score, yCount: f.yellow_and_above };
                });
            }

            // Sort floors by score desc, then by floor num
            const getFloorNum = (f) => f.startsWith('B') ? -parseInt(f.substring(1)) : parseInt(f);
            const sortedFloors = Object.keys(floorGroups).sort((a, b) => {
                const sA = scoreMap[a] ? scoreMap[a].score : -1;
                const sB = scoreMap[b] ? scoreMap[b].score : -1;
                if (sA !== sB) return sB - sA;
                return getFloorNum(a) - getFloorNum(b);
            });

            gridContainer.innerHTML = sortedFloors.map(floor => {
                const floorRooms = floorGroups[floor];
                const sm = scoreMap[floor];
                const rankHtml = sm ? `<div class="floor-rank">#${sm.rank}</div>` : `<div class="floor-rank unranked">-</div>`;
                const scoreHtml = sm ? `<div class="floor-score">${sm.score.toFixed(1)}分</div>` : `<div class="floor-score text-muted">未達標</div>`;
                
                return `
                    <div class="floor-row">
                        <div class="floor-row-header">
                            ${rankHtml}
                            <h4>${floor}F</h4>
                            ${scoreHtml}
                            <small>達標 ${sm ? sm.yCount : 0} 間</small>
                        </div>
                        <div class="floor-row-rooms">
                            ${floorRooms.map(r => `
                                <div class="room-card status-${r.light || r.status.toLowerCase()}" title="${r.type} | 上次翻床: ${r.date || r.last_turned.split('T')[0]}">
                                    <span class="room-no">${r.no}</span>
                                    <span class="room-nights">${r.nights} 晚</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 渲染樓層清單
        const floorListEl = document.getElementById('floor-list');
        if (planData.suggested_floors && planData.suggested_floors.length > 0) {
            floorListEl.innerHTML = planData.suggested_floors.map(f => `
                <div class="floor-item">
                    <div class="floor-info">
                        <h4>${f.floor} 樓</h4>
                        <p>黃燈以上 ${f.yellow_and_above} 間 | 藍燈以上 ${f.blue_and_above} 間</p>
                    </div>
                    <div class="floor-score">
                        <div class="score-val">${f.score.toFixed(1)}</div>
                        <div class="score-label">急迫度得分</div>
                    </div>
                </div>
            `).join('');
        } else {
            floorListEl.innerHTML = `<div class="empty-state">目前無樓層達標</div>`;
        }
    },

    // 載入建立計畫視窗
    async loadPlanView() {
        try {
            const response = await fetch('/api/v1/plans/suggested-floors');
            if (!response.ok) throw new Error('API Error');
            const data = await response.json();
            
            const floorSelect = document.getElementById('plan-floor-select');
            const currVal = floorSelect.value;
            
            if (data.suggested_floors) {
                floorSelect.innerHTML = `<option value="">請選擇樓層...</option>` + 
                    data.suggested_floors.map(f => `<option value="${f.floor}">${f.floor} 樓 - 得分 ${f.score.toFixed(1)} (推薦)</option>`).join('');
            }
            if (currVal) floorSelect.value = currVal;
    
            // 如果有選樓層，去抓那層的房間 (呼叫 search API)
            this.renderPlanRooms();
        } catch (e) {
            console.error(e);
        }
    },

    async renderPlanRooms() {
        const floor = document.getElementById('plan-floor-select').value;
        const listEl = document.getElementById('plan-room-list');
        const countEl = document.getElementById('plan-room-count');

        if (!floor) {
            listEl.innerHTML = '<div class="empty-state">請先選擇左側樓層</div>';
            countEl.textContent = '0 間';
            return;
        }

        try {
            const response = await fetch(`/api/v1/plans/floor-rooms?floor=${floor}`);
            if (!response.ok) throw new Error('API Error');
            const data = await response.json();
            let rooms = data.rooms || [];
            
            // 過濾：只保留非綠燈的房間
            rooms = rooms.filter(r => r.light.toLowerCase() !== 'green');

            if (rooms.length === 0) {
                listEl.innerHTML = '<div class="empty-state">該樓層無須翻床客房</div>';
                countEl.textContent = '0 間';
                return;
            }

            listEl.innerHTML = rooms.map(r => `
                <label class="list-item-room">
                    <div>
                        <div class="room-title">${r.room} ${this.getLightBadge(r.light)}</div>
                        <div class="room-desc">${r.type} | 累計 ${r.nights} 晚</div>
                    </div>
                    <div class="checkbox-item">
                        <span>排入</span>
                        <input type="checkbox" class="plan-room-check" value="${r.room}" checked>
                    </div>
                </label>
            `).join('');

            countEl.textContent = `${rooms.length} 間`;
            
            document.querySelectorAll('.plan-room-check').forEach(chk => {
                chk.addEventListener('change', (e) => {
                    const item = e.target.closest('.list-item-room');
                    if (e.target.checked) item.classList.remove('excluded');
                    else item.classList.add('excluded');
                    countEl.textContent = `${document.querySelectorAll('.plan-room-check:checked').length} 間`;
                });
            });
        } catch (e) {
            listEl.innerHTML = '<div class="empty-state">無法連線至後端伺服器</div>';
        }
    },

    async createPlan() {
        const floor = document.getElementById('plan-floor-select').value;
        const dateStr = document.getElementById('plan-date').value;
        const confirmedStr = document.getElementById('plan-confirm').value;
        
        const rooms = Array.from(document.querySelectorAll('.plan-room-check:checked')).map(el => el.value);
        if (rooms.length === 0) return showToast('請至少選擇一間房', 'error');

        const payload = {
            floor: floor,
            plan_date: dateStr,
            rooms: rooms
        };

        try {
            const response = await fetch('/api/v1/plans/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error('API Error');
            const res = await response.json();
            
            if (res.status === 'ok') {
                showToast(`✅ 計畫建立成功！排入 ${res.inserted_count} 間`, 'success');
                if (res.skipped && res.skipped.length > 0) {
                    showToast(`⚠️ 有 ${res.skipped.length} 間已經在其他未執行計畫中，自動略過排程。`, 'warning');
                }
                document.getElementById('plan-form').reset();
                this.loadRecordView(); // 更新紀錄頁面的下拉
            } else {
                showToast(`建立失敗: ${res.message}`, 'error');
            }
        } catch (e) {
            showToast('❌ 無法連線至真實後端', 'error');
        }
    },

    async loadRecordView() {
        try {
            const response = await fetch('/api/v1/execution/pending');
            if (!response.ok) throw new Error('API Error');
            const data = await response.json();
            window.currentPendingPlans = data.plans || [];
            
            const select = document.getElementById('record-plan-select');
            select.innerHTML = `<option value="">請選擇待處理計畫...</option>` + 
                window.currentPendingPlans.map((p, idx) => `<option value="${idx}">${p.plan_date} - ${p.floor}樓 (${p.rooms.length}間)</option>`).join('');
    
            this.renderRecordRooms();
        } catch (e) {
            console.error(e);
        }
    },

    renderRecordRooms() {
        const planIdx = document.getElementById('record-plan-select').value;
        const listEl = document.getElementById('record-room-list');
        const countEl = document.getElementById('record-checked-count');

        if (planIdx === "") {
            listEl.innerHTML = '<div class="empty-state">請先選擇計畫</div>';
            countEl.textContent = '0 間';
            return;
        }

        const plan = window.currentPendingPlans[planIdx];
        
        listEl.innerHTML = plan.rooms.map(r => `
            <div class="list-item-room">
                <label class="checkbox-item" style="flex:1; cursor:pointer;">
                    <input type="checkbox" class="record-room-check" value="${r.room}">
                    <div>
                        <div class="room-title">${r.room} ${this.getLightBadge(r.light)}</div>
                        <div class="room-desc">${r.type} | 已累計 ${r.nights} 晚</div>
                    </div>
                </label>
            </div>
        `).join('');

        const updateCount = () => {
            countEl.textContent = `${document.querySelectorAll('.record-room-check:checked').length} 間`;
        };

        // Handle Checkbox Changes
        const checks = Array.from(document.querySelectorAll('.record-room-check'));
        checks.forEach(chk => {
            chk.addEventListener('change', (e) => {
                const mode = document.querySelector('input[name="record-mode"]:checked').value;
                if (mode === 'batch') {
                    const targetValue = e.target.value;
                    let checkAll = true;
                    checks.forEach(c => {
                        if (checkAll) {
                            c.checked = true;
                            if (c.value === targetValue) checkAll = false;
                        } else {
                            c.checked = false;
                        }
                    });
                }
                updateCount();
            });
        });
        
        updateCount();
    },

    async completePlan() {
        const planIdx = document.getElementById('record-plan-select').value;
        if (planIdx === "") return showToast('請先選擇計畫', 'error');

        const turnedRooms = Array.from(document.querySelectorAll('.record-room-check:checked')).map(el => el.value);
        if (turnedRooms.length === 0) return showToast('請至少勾選一間房歸零', 'error');

        const executeDate = document.getElementById('record-date').value;

        const payload = { 
            rooms: turnedRooms,
            execute_date: executeDate
        };

        try {
            const response = await fetch('/api/v1/execution/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error('API Error');
            const res = await response.json();
            
            if (res.status === 'ok') {
                showToast(`🎉 成功結算 ${res.executed_count} 間客房，狀態已歸零！`, 'success');
                this.loadRecordView();
                this.loadDashboard();
            } else {
                showToast(`結算失敗: ${res.message}`, 'error');
            }
        } catch (e) {
            showToast('❌ 無法連線至真實後端', 'error');
        }
    },

    async loadExceptions() {
        try {
            const response = await fetch('/api/v1/exceptions');
            if (!response.ok) throw new Error('API Error');
            const data = await response.json();
            const tbody = document.getElementById('exception-table-body');
            
            if (!data.rooms || data.rooms.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">無異常紀錄</td></tr>`;
                return;
            }
    
            tbody.innerHTML = data.rooms.map(e => `
                <tr>
                    <td>${e.date}</td>
                    <td><strong>${e.room}</strong></td>
                    <td>${e.type}</td>
                    <td>${e.night} 晚</td>
                    <td>${this.getLightBadge(e.light)}</td>
                </tr>
            `).join('');
        } catch (e) {
            console.error(e);
        }
    },

    async submitException() {
        const no = document.getElementById('exc-room-no').value;
        
        try {
            const response = await fetch('/api/v1/exceptions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_no: no })
            });
            if (!response.ok) throw new Error('API Error');
            const res = await response.json();
            
            if (res.status === 'success') {
                showToast('🚨 異常紀錄已儲存', 'warning');
                document.getElementById('exception-form').reset();
                this.loadExceptions();
            } else {
                showToast(res.message || '找不到該房號', 'error');
            }
        } catch (e) {
            showToast('❌ 無法連線至真實後端', 'error');
        }
    },

    async loadSettings() {
        // API: GET /parameters
        const paramRes = await apiClient.request('GET', '/parameters');
        if (paramRes.status === 'success') {
            const t = paramRes.parameters;
            
            document.getElementById('p-single-can').value = t.single.can;
            document.getElementById('p-single-rec').value = t.single.rec;
            document.getElementById('p-single-urg').value = t.single.urg;

            document.getElementById('p-twin-can').value = t.twin.can;
            document.getElementById('p-twin-rec').value = t.twin.rec;
            document.getElementById('p-twin-urg').value = t.twin.urg;

            document.getElementById('p-double-can').value = t.double.can;
            document.getElementById('p-double-rec').value = t.double.rec;
            document.getElementById('p-double-urg').value = t.double.urg;

            document.getElementById('p-quad-can').value = t.quad.can;
            document.getElementById('p-quad-rec').value = t.quad.rec;
            document.getElementById('p-quad-urg').value = t.quad.urg;
        }

        // API: GET /parameters/suggestion
        const aiData = await apiClient.request('GET', '/parameters/suggestion');
        const aiListEl = document.getElementById('ai-suggestion-list');

        if (aiData.suggestions && aiData.suggestions.length > 0) {
            aiListEl.innerHTML = aiData.suggestions.map(s => `
                <div class="ai-card">
                    <div class="ai-card-header">
                        <h4>${s.type}</h4>
                        <span class="badge ${s.new_val < s.old_val ? 'green' : 'yellow'}">
                            建議調整為 ${s.new_val} 晚 (原 ${s.old_val})
                        </span>
                    </div>
                    <div class="ai-card-body">
                        <p>${s.reason}</p>
                    </div>
                </div>
            `).join('');
        } else {
            aiListEl.innerHTML = '<div class="empty-state">目前無需調整參數</div>';
        }
    },

    async applyAISuggestion(type, val) {
        // API: PUT /parameters
        const typeMapRev = { '單人房': 'single', '雙人房': 'twin', '四人房': 'quad', '套房': 'quad' };
        const key = typeMapRev[type] || 'single';
        const payload = {};
        payload[key] = { rec: val };
        
        const res = await apiClient.request('PUT', '/parameters', payload);
        if (res.status === 'success') {
            showToast(`✅ 已更新 ${type} 門檻`, 'success');
            this.loadDashboard();
        }
    },
    
    async exportCsv() {
        try {
            const response = await fetch('/api/v1/report/export', { method: 'POST' });
            if (!response.ok) throw new Error('API Error');
            const res = await response.json();
            if (res.status === 'success') {
                showToast(`📊 報表產生成功：${res.file}`, 'success');
                // 建立臨時連結以觸發瀏覽器下載
                const a = document.createElement('a');
                a.href = res.path;
                a.download = res.file;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        } catch (e) {
            showToast('❌ 報表匯出失敗', 'error');
        }
    }
};

// ==========================================
// 事件綁定與初始化
// ==========================================

function initEvents() {
    // 樓層選項已改為在 loadDashboard() 中自真實後端資料動態載入

    // Nav Navigation
    document.querySelectorAll('.nav-item').forEach(nav => {
        if (nav.id === 'export-csv-btn') return;
        nav.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = nav.getAttribute('data-target');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            nav.classList.add('active');
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');
            document.getElementById('page-title').textContent = nav.textContent.replace('✦', '').trim();

            // Hook View Controllers
            if (targetId === 'view-dashboard') ViewControllers.loadDashboard();
            if (targetId === 'view-plan') ViewControllers.loadPlanView();
            if (targetId === 'view-record') ViewControllers.loadRecordView();
            if (targetId === 'view-exception') ViewControllers.loadExceptions();
            if (targetId === 'view-ai' || targetId === 'view-settings') ViewControllers.loadSettings();
        });
    });

    // Filters
    ['filter-floor', 'filter-type', 'filter-light'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => ViewControllers.loadDashboard());
    });
    document.getElementById('btn-apply-filter').addEventListener('click', () => ViewControllers.loadDashboard());

    // Plan
    document.getElementById('plan-floor-select').addEventListener('change', () => ViewControllers.renderPlanRooms());
    document.getElementById('plan-form').addEventListener('submit', (e) => { e.preventDefault(); ViewControllers.createPlan(); });

    // Record
    document.getElementById('record-plan-select').addEventListener('change', () => ViewControllers.renderRecordRooms());
    document.getElementById('record-form').addEventListener('submit', (e) => { e.preventDefault(); ViewControllers.completePlan(); });

    // Exception
    document.getElementById('exception-form').addEventListener('submit', (e) => { e.preventDefault(); ViewControllers.submitException(); });
    
    // Export
    document.getElementById('export-csv-btn').addEventListener('click', (e) => { e.preventDefault(); ViewControllers.exportCsv(); });

    // Settings Tabs
    document.querySelectorAll('.setting-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.target.getAttribute('data-target');
            document.querySelectorAll('.setting-tab-btn').forEach(b => {
                b.classList.remove('active');
                b.style.borderBottomColor = 'transparent';
                b.style.color = 'var(--text-muted)';
            });
            e.target.classList.add('active');
            e.target.style.borderBottomColor = 'var(--primary)';
            e.target.style.color = 'white';
            
            document.querySelectorAll('.setting-tab-pane').forEach(pane => {
                pane.style.display = 'none';
            });
            document.getElementById(targetId).style.display = 'block';
        });
    });

    // Settings Save
    document.getElementById('btn-save-thresholds').addEventListener('click', async () => {
        const payload = { 
            single: { 
                can: parseInt(document.getElementById('p-single-can').value),
                rec: parseInt(document.getElementById('p-single-rec').value),
                urg: parseInt(document.getElementById('p-single-urg').value)
            },
            twin: { 
                can: parseInt(document.getElementById('p-twin-can').value),
                rec: parseInt(document.getElementById('p-twin-rec').value),
                urg: parseInt(document.getElementById('p-twin-urg').value)
            },
            double: { 
                can: parseInt(document.getElementById('p-double-can').value),
                rec: parseInt(document.getElementById('p-double-rec').value),
                urg: parseInt(document.getElementById('p-double-urg').value)
            },
            quad: { 
                can: parseInt(document.getElementById('p-quad-can').value),
                rec: parseInt(document.getElementById('p-quad-rec').value),
                urg: parseInt(document.getElementById('p-quad-urg').value)
            }
        }; 
        try {
            const response = await fetch('/api/v1/parameters', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error('API Error');
            showToast('✅ 參數更新成功，已寫入真實後端資料庫！', 'success');
            // 由於目前 dashboard 仍依賴 mock，我們也同步更新 mock 讓前端即時反應
            await apiClient.request('PUT', '/parameters', payload);
        } catch (e) {
            showToast('❌ 無法連線至真實後端，請確認 app.py 是否啟動', 'error');
        }
    });

    document.getElementById('btn-save-weights').addEventListener('click', async () => {
        const payload = {
            minYellow: parseInt(document.getElementById('setting-min-yellow').value),
            redWeight: parseFloat(document.getElementById('setting-red-weight').value)
        };
        try {
            const response = await fetch('/api/v1/weights', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error('API Error');
            showToast('✅ 權重更新成功，已寫入真實後端資料庫！', 'success');
        } catch (e) {
            showToast('❌ 無法連線至真實後端，請確認 app.py 是否啟動', 'error');
        }
    });

    document.querySelectorAll('input[name="ai-auth"]').forEach(r => {
        r.addEventListener('change', async (e) => {
            if (e.target.value === 'auto') {
                await apiClient.request('PUT', '/parameters/authorize', { authorize: true });
                showToast('已授權 AI 自動調整參數', 'success');
            }
        });
    });
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    void toast.offsetWidth;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    // Default load
    ViewControllers.loadDashboard();
    
    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('plan-date').value = today;
    document.getElementById('record-date').value = today;
    document.getElementById('exc-date').value = today;
});
