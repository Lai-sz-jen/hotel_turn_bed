from flask import Flask, render_template, jsonify, request, send_file
from services.web_service import BedTurningWebService

app = Flask(__name__)
ws = BedTurningWebService()

@app.route('/')
def dashboard():
    # 確保資料庫有假資料供展示
    ws.ensure_dummy_data()
    return send_file('index.html')

@app.route('/<path:filename>')
def static_files(filename):
    if filename in ['styles.css', 'script.js']:
        return send_file(filename)
    return "Not Found", 404

# [模組 1：儀錶板 API]
@app.route('/api/v1/dashboard/summary', methods=['GET'])
def get_dashboard_data():
    floors = ws.get_suggested_floors().get('suggested_floors', [])
    rooms = ws.get_all_rooms_status()
    return jsonify({"suggested_floors": floors, "rooms": rooms})

@app.route('/api/v1/report/export', methods=['POST'])
def export_report():
    return jsonify({
        "status": "success", 
        "path": "/downloads/bed_turning_report_2026.csv", 
        "file": "bed_turning_report_2026.csv"
    })

# [模組 2：翻床計畫 API]
# 注意：建立計畫只會把房間排入計畫 (status=0)，不會歸零累計晚數。
@app.route('/api/v1/plans/suggested-floors', methods=['GET'])
def get_plan_floors():
    return jsonify(ws.get_suggested_floors())

@app.route('/api/v1/plans/floor-rooms', methods=['GET'])
def get_plan_floor_rooms():
    floor = request.args.get('floor', '')
    return jsonify({"rooms": ws.get_floor_rooms(floor)})

@app.route('/api/v1/plans/create', methods=['POST'])
def create_plan():
    data = request.json or {}
    res = ws.create_plan(data.get('floor'), data.get('rooms', []), data.get('plan_date'))
    return jsonify(res)

# [模組 2-2：翻床執行紀錄 API]（新增）
# 翻床「完成後」才在這裡登記實際翻床的房間，此時才會歸零累計晚數。
@app.route('/api/v1/execution/pending', methods=['GET'])
def get_pending_executions():
    return jsonify({"plans": ws.get_pending_plans()})

@app.route('/api/v1/execution/confirm', methods=['POST'])
def confirm_execution():
    data = request.json or {}
    res = ws.confirm_execution(data.get('rooms', []), data.get('execute_date'))
    return jsonify(res)

# [模組 3：異常紀錄 API]
@app.route('/api/v1/exceptions', methods=['GET', 'POST'])
def handle_exceptions():
    if request.method == 'POST':
        # 模擬儲存異常通報
        return jsonify({"status": "ok"})
    return jsonify({"exceptions": ws.get_mock_exceptions()})

# [新增] 參數設定 API (直接對資料庫下 SQL，符合前端 payload)
@app.route('/api/v1/parameters', methods=['PUT'])
def update_parameters():
    data = request.json or {}
    
    # 前端鍵值對應到資料庫房型名稱
    type_map = {
        'single': '單人房',
        'twin': '雙人房',
        'double': '兩大床',
        'quad': '總統套房'  # 或四人房
    }
    
    with ws._get_conn() as conn:
        c = conn.cursor()
        for en_key, thres in data.items():
            if en_key in type_map and isinstance(thres, dict):
                zh_type = type_map[en_key]
                can_val = thres.get('can', 0)
                rec_val = thres.get('rec', 0)
                urg_val = thres.get('urg', 0)
                
                # 嘗試更新，若不存在則不處理或另外 INSERT
                c.execute("""
                    UPDATE WeightValue 
                    SET allowable_turning_threshold = ?, 
                        recommended_turning_threshold = ?, 
                        urgent_turning_threshold = ?
                    WHERE room_type = ?
                """, (can_val, rec_val, urg_val, zh_type))
                
                # 若無該房型，可能需要 INSERT (根據需要可加入)
                if c.rowcount == 0:
                    c.execute("""
                        INSERT INTO WeightValue 
                        (room_type, allowable_turning_threshold, recommended_turning_threshold, urgent_turning_threshold, minimum_urgency_threshold, red_status_room_weight, yellow_status_room_weight, blue_status_room_weight)
                        VALUES (?, ?, ?, ?, 10, 2.0, 1.0, 0.0)
                    """, (zh_type, can_val, rec_val, urg_val))
        conn.commit()
        
    return jsonify({"status": "success", "message": "Parameters updated successfully."})

@app.route('/api/v1/weights', methods=['PUT'])
def update_weights():
    data = request.json or {}
    min_yellow = data.get('minYellow')
    red_weight = data.get('redWeight')
    
    with ws._get_conn() as conn:
        c = conn.cursor()
        if min_yellow is not None and red_weight is not None:
            c.execute("""
                UPDATE WeightValue 
                SET minimum_urgency_threshold = ?, 
                    red_status_room_weight = ?
            """, (min_yellow, red_weight))
        conn.commit()
        
    return jsonify({"status": "success", "message": "Weights updated successfully."})

# [模組 4：AI與參數 API]
@app.route('/api/v1/ai/advice', methods=['GET'])
def get_ai_advice():
    return jsonify(ws.get_mock_ai_advice())

# [系統管理：重置示範資料]
@app.route('/api/v1/admin/reset-demo-data', methods=['POST'])
def reset_demo_data():
    res = ws.reset_demo_data()
    return jsonify(res)

if __name__ == '__main__':
    app.run(debug=False, port=5000)
