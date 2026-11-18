"""Probelauf des Python-Workers auf dem Mac (Protokoll v1 über stdin/stdout), ohne Electron.
Aufruf: python -I scripts/mac-worker-test.py <python-der-umgebung> <modelId> <modellordner> <arbeitsordner> <aufgabe> [args...]
  av    <clip.mp4> <prompt>         → analyze_av (Gemma 4 / MiniCPM-o)
  embed <bild1.jpg,bild2.jpg;...>   → embed_frames + embed_text (Qwen3-VL-Embedding)
Gibt Antworten und Zeiten als JSON aus. ffmpeg/ffprobe müssen im PATH liegen."""
import json
import subprocess
import sys
import time
import os

py, model_id, model_dir, work, task, *rest = sys.argv[1:]
here = os.path.dirname(os.path.abspath(__file__))
worker = os.path.join(here, "..", "resources", "python", "worker.py")
p = subprocess.Popen([py, "-I", worker, "--allowed-root", work, "--model-root", os.path.dirname(model_dir)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
n = 0


def call(op, payload, timeout=900):
    global n
    n += 1
    p.stdin.write(json.dumps({"protocolVersion": 1, "requestId": f"r{n}", "runId": "test", "op": op, "payload": payload}) + "\n")
    p.stdin.flush()
    t0 = time.time()
    while True:
        line = p.stdout.readline()
        if not line:
            raise SystemExit("Worker beendet")
        m = json.loads(line)
        if m.get("requestId") == f"r{n}":
            m["_wall"] = round(time.time() - t0, 1)
            return m
        if time.time() - t0 > timeout:
            raise SystemExit("Zeitüberschreitung")


print(json.loads(p.stdout.readline()))
print("health", call("health", {}))
print("load", call("load_model", {"modelId": model_id, "modelDir": model_dir}))
if task == "av":
    r = call("analyze_av", {"path": rest[0], "prompt": rest[1], "maxNewTokens": 400})
    print("av", json.dumps(r, ensure_ascii=False))
elif task == "embed":
    wins = [{"id": f"w{i}", "frames": w.split(",")} for i, w in enumerate(rest[0].split(";"))]
    r = call("embed_frames", {"windows": wins, "outPath": os.path.join(work, "v.npy")})
    print("frames", r)
    print("text", call("embed_text", {"texts": rest[1].split("|"), "outPath": os.path.join(work, "q.npy")}))
print("unload", call("unload_model", {}))
call("shutdown", {})
