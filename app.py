from flask import Flask, jsonify
import time
app = Flask(__name__)

@app.route('/')
def index():
    return jsonify({"status": "online"})

@app.route('/api/stats')
def api_stats():
    try:
        from puente import stats
        uptime = int(time.time() - stats["start_time"])
        h, m = divmod(uptime, 3600); m, s = divmod(m, 60)
        return jsonify({
            "uptime": f"{h}h {m}m {s}s",
            "archivos": stats["archivos_subidos"],
            "total_bytes": stats["total_bytes"],
            "ultimo": stats["ultimo_archivo"]
        })
    except:
        return jsonify({"error": "Stats not available"})
