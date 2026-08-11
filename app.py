from flask import Flask, render_template, jsonify
import time

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('stats.html')

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
            "ultimo": stats["ultimo_archivo"],
            "error": stats["ultimo_error"],
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        })
    except:
        return jsonify({"error": "Stats no disponibles"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=10000)
