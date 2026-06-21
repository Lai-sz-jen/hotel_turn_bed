import sqlite3
import os
from datetime import datetime

class BedTurningWebService:
    def __init__(self, db_path="hotel_bed.db"):
        self.db_path = db_path
        self._ensure_schema()

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _ensure_schema(self):
        """建立基本資料表結構（若尚未存在）。對應 DB 設計：Room / WeightValue / BedTurningRecord"""
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute("""
                CREATE TABLE IF NOT EXISTS Room (
                    room_number TEXT PRIMARY KEY,
                    room_type TEXT NOT NULL,
                    floor TEXT NOT NULL,
                    last_bed_turning_date TEXT,
                    cumulative_nights INTEGER NOT NULL DEFAULT 0
                )
            """)
            c.execute("""
                CREATE TABLE IF NOT EXISTS WeightValue (
                    room_type TEXT PRIMARY KEY,
                    allowable_turning_threshold INTEGER NOT NULL,
                    recommended_turning_threshold INTEGER NOT NULL,
                    urgent_turning_threshold INTEGER NOT NULL,
                    minimum_urgency_threshold INTEGER NOT NULL,
                    red_status_room_weight REAL NOT NULL DEFAULT 2.0,
                    yellow_status_room_weight REAL NOT NULL DEFAULT 1.0,
                    blue_status_room_weight REAL NOT NULL DEFAULT 0.0
                )
            """)
            # BedTurningRecord：對應「翻床計畫 / 翻床執行紀錄」共用之資料表
            # status: 0 = 計畫中、尚未執行 (僅建立計畫，晚數尚未歸零)
            #         1 = 已於翻床執行紀錄模組登記完成 (晚數已歸零)
            c.execute("""
                CREATE TABLE IF NOT EXISTS BedTurningRecord (
                    record_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    turning_date TEXT,
                    room_number TEXT NOT NULL,
                    status INTEGER NOT NULL DEFAULT 0,
                    confirm INTEGER,
                    executive_floor TEXT,
                    created_at TEXT,
                    FOREIGN KEY (room_number) REFERENCES Room(room_number)
                )
            """)
            conn.commit()

    def ensure_dummy_data(self):
        with self._get_conn() as conn:
            c = conn.cursor()
            # 檢查 Room 表是否有資料
            c.execute("SELECT COUNT(*) FROM Room")
            if c.fetchone()[0] == 0:
                print("自動寫入測試展示數據...")
                # 寫入房型門檻
                c.executemany("INSERT OR IGNORE INTO WeightValue VALUES (?,?,?,?,?,?,?,?)", [
                    ("雙人房", 15, 30, 45, 10, 5.0, 3.0, 1.0),
                    ("單人房", 20, 40, 60, 12, 5.0, 3.0, 1.0),
                    ("總統套房", 10, 20, 30, 8, 5.0, 3.0, 1.0)
                ])
                # 寫入房間假資料
                rooms_data = [
                    ("301", "雙人房", "3", "2026-05-01", 48), # 紅燈
                    ("302", "雙人房", "3", "2026-05-10", 35), # 黃燈
                    ("303", "單人房", "3", "2026-05-20", 16), # 藍燈
                    ("501", "總統套房", "5", "2026-04-15", 32), # 紅燈
                    ("502", "雙人房", "5", "2026-05-18", 31), # 黃燈
                    ("701", "單人房", "7", "2026-06-01", 5),  # 綠燈
                    ("702", "雙人房", "7", "2026-06-02", 4)   # 綠燈
                ]
                c.executemany("INSERT OR IGNORE INTO Room VALUES (?,?,?,?,?)", rooms_data)
                conn.commit()
            # 注意：不預先寫入任何「翻床計畫/執行紀錄」示範資料，
            # 故系統初始狀態下「翻床執行紀錄」模組的待登記清單為空，
            # 需先至「翻床計畫建立」模組建立計畫後才會出現。

    def _calc_light(self, nights, blue, yellow, red):
        if nights >= red: return "red"
        if nights >= yellow: return "yellow"
        if nights >= blue: return "blue"
        return "green"

    def get_suggested_floors(self):
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute("SELECT floor, SUM(cumulative_nights) as score FROM Room GROUP BY floor ORDER BY score DESC LIMIT 3")
            floors = [{"floor": str(r[0]), "score": float(r[1]), "blue_and_above": 2, "yellow_and_above": 1} for r in c.fetchall()]
            return {"suggested_floors": floors}

    def get_all_rooms_status(self):
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute("SELECT r.room_number, r.room_type, r.floor, r.cumulative_nights, w.allowable_turning_threshold, w.recommended_turning_threshold, w.urgent_turning_threshold FROM Room r JOIN WeightValue w ON r.room_type = w.room_type")
            res = []
            for row in c.fetchall():
                num, t, fl, nights, blue, yellow, red = row
                light = self._calc_light(nights, blue, yellow, red)
                res.append({"room": num, "type": t, "floor": fl, "nights": nights, "light": light})
            return res

    # ------------------------------------------------------------------
    # [翻床計畫建立 FE-02-1 / FE-02-2]
    # 僅建立計畫 (寫入 BedTurningRecord, status=0)，不會異動 Room 的累計晚數
    # ------------------------------------------------------------------
    def get_floor_rooms(self, floor):
        """取得指定樓層之房間清單，依優先級(累計晚數)由高到低排序，供建立計畫時勾選"""
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute("""
                SELECT r.room_number, r.room_type, r.cumulative_nights,
                       w.allowable_turning_threshold, w.recommended_turning_threshold, w.urgent_turning_threshold
                FROM Room r JOIN WeightValue w ON r.room_type = w.room_type
                WHERE r.floor = ?
                ORDER BY r.cumulative_nights DESC
            """, (str(floor),))
            res = []
            for num, t, nights, blue, yellow, red in c.fetchall():
                res.append({
                    "room": num, "type": t, "nights": nights,
                    "light": self._calc_light(nights, blue, yellow, red)
                })
            return res

    def create_plan(self, floor, rooms, plan_date):
        """建立翻床計畫：只記錄「計畫」(status=0)，不歸零晚數、不更新最後翻床日期"""
        if not rooms:
            return {"status": "error", "message": "未選擇任何房間"}
        plan_date = plan_date or datetime.now().strftime("%Y-%m-%d")
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        inserted, skipped = [], []
        with self._get_conn() as conn:
            c = conn.cursor()
            for room in rooms:
                # 防重複排程：同一房間若已有尚未執行的計畫，則跳過 (對應 sp_CreatePlan 之 Idempotency 設計)
                c.execute("SELECT COUNT(*) FROM BedTurningRecord WHERE room_number=? AND status=0", (room,))
                if c.fetchone()[0] > 0:
                    skipped.append(room)
                    continue
                c.execute(
                    "INSERT INTO BedTurningRecord (turning_date, room_number, status, executive_floor, created_at) VALUES (?,?,0,?,?)",
                    (plan_date, room, str(floor), now)
                )
                inserted.append(room)
            conn.commit()
        return {"status": "ok", "inserted_count": len(inserted), "rooms": inserted, "skipped": skipped}

    # ------------------------------------------------------------------
    # [翻床執行紀錄 FE-02-3] 新模組
    # 翻床「完成後」才在此登記實際翻床的房間，此時才歸零累計晚數
    # ------------------------------------------------------------------
    def get_pending_plans(self):
        """取得所有尚未登記執行結果的計畫，依樓層+計畫日期分組，房間依優先級排序"""
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute("""
                SELECT br.record_id, br.executive_floor, br.turning_date, br.room_number,
                       r.room_type, r.cumulative_nights,
                       w.allowable_turning_threshold, w.recommended_turning_threshold, w.urgent_turning_threshold
                FROM BedTurningRecord br
                JOIN Room r ON br.room_number = r.room_number
                JOIN WeightValue w ON r.room_type = w.room_type
                WHERE br.status = 0
                ORDER BY br.executive_floor, br.turning_date, r.cumulative_nights DESC
            """)
            groups = {}
            for record_id, floor, plan_date, room, rtype, nights, blue, yellow, red in c.fetchall():
                key = (floor, plan_date)
                if key not in groups:
                    groups[key] = {"floor": floor, "plan_date": plan_date, "rooms": []}
                groups[key]["rooms"].append({
                    "record_id": record_id, "room": room, "type": rtype, "nights": nights,
                    "light": self._calc_light(nights, blue, yellow, red)
                })
            return list(groups.values())

    def confirm_execution(self, rooms, execute_date):
        """翻床執行紀錄模組：登記實際完成翻床的房間 → 此時才歸零累計晚數、更新最後翻床日期、結案該計畫"""
        if not rooms:
            return {"status": "error", "message": "未選擇任何房間"}
        execute_date = execute_date or datetime.now().strftime("%Y-%m-%d")
        with self._get_conn() as conn:
            c = conn.cursor()
            executed = []
            for room in rooms:
                c.execute("SELECT COUNT(*) FROM BedTurningRecord WHERE room_number=? AND status=0", (room,))
                if c.fetchone()[0] == 0:
                    continue  # 該房間沒有待執行的計畫，略過
                # 歸零累計晚數、更新最後翻床日期 —— 僅在此處（執行登記）才會發生
                c.execute(
                    "UPDATE Room SET cumulative_nights = 0, last_bed_turning_date = ? WHERE room_number = ?",
                    (execute_date, room)
                )
                # 結案該計畫紀錄，避免未來重複紀錄
                c.execute(
                    "UPDATE BedTurningRecord SET status = 1, turning_date = ? WHERE room_number = ? AND status = 0",
                    (execute_date, room)
                )
                executed.append(room)
            conn.commit()
            return {"status": "ok", "executed_count": len(executed), "rooms": executed}

    def reset_demo_data(self):
        """重置示範資料：清空所有資料表並重新寫入初始示範資料（含一筆待登記之示範計畫）"""
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute("DELETE FROM BedTurningRecord")
            c.execute("DELETE FROM Room")
            c.execute("DELETE FROM WeightValue")
            conn.commit()
        self.ensure_dummy_data()
        return {"status": "ok"}

    def get_mock_exceptions(self):
        return [
            {"date": "2026-06-18", "room": "301", "type": "雙人房", "nights": 48, "light": "red", "note": "床墊左側明顯塌陷"},
            {"date": "2026-06-19", "room": "501", "type": "總統套房", "nights": 32, "light": "red", "note": "客人反應彈簧有異音"}
        ]

    def get_mock_ai_advice(self):
        return {
            "room_type": "雙人房",
            "current_yellow": 30,
            "suggested_yellow": 24,
            "reason": "經AI統計分析，『雙人房』過去3筆損壞平均發生在第26.2晚，早於現行黃燈預警門檻(30晚)。建議整體調降門檻20%以延長資產壽命。"
        }
