"""Servidor web de estadísticas del puente ToDus"""
from flask import Flask, render_template, jsonify
import json, os, time

app = Flask(__name__)

# Estadísticas en memoria
stats = {
    "start_time": time.time(),
    "mensajes_texto": 0,
    "imagenes": 0,
    "videos": 0,
    "ultimo_mensaje": None,
    "ultimo_error": None,
    "conectado_todus": False,
    "conectado_telegram": False
}

def actualizar_estadisticas(tipo, texto=None, error=None):
    if tipo == "texto":
        stats["mensajes_texto"] += 1
    elif tipo == "imagen":
        stats["imagenes"] += 1
    elif tipo == "video":
        stats["videos"] += 1
    if texto:
        stats["ultimo_mensaje"] = texto[:100]
    if error:
        stats["ultimo_error"] = error[:100]

@app.route('/')
def index():
    return render_template('stats.html')

@app.route('/api/stats')
def api_stats():
    uptime = int(time.time() - stats["start_time"])
    horas = uptime // 3600
    minutos = (uptime % 3600) // 60
    segundos = uptime % 60
    
    return jsonify({
        "uptime": f"{horas}h {minutos}m {segundos}s",
        "mensajes_texto": stats["mensajes_texto"],
        "imagenes": stats["imagenes"],
        "videos": stats["videos"],
        "total": stats["mensajes_texto"] + stats["imagenes"] + stats["videos"],
        "ultimo_mensaje": stats["ultimo_mensaje"],
        "ultimo_error": stats["ultimo_error"],
        "conectado_todus": stats["conectado_todus"],
        "conectado_telegram": stats["conectado_telegram"],
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=10000)
