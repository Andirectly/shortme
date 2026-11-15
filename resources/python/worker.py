"""Shortme AI-Worker (Engine 3): lokaler Python-Kindprozess, gesteuert von Electron über Zeilen-JSON auf stdin/stdout (Protokoll v1).

Sicherheit
- stdout gehört dem Protokoll (eine JSON-Zeile je Nachricht); Logs gehen auf stderr.
- Dateipfade werden nur akzeptiert, wenn sie innerhalb der beim Start übergebenen Wurzeln liegen (--allowed-root, --model-root). Keine Pfade aus Modelltext.
- Keine Pickles: Vektoren werden als .npy mit allow_pickle=False geschrieben; Modelle nur aus safetensors.
- Keine Netzwerkverbindung nötig oder erlaubt (HF_HUB_OFFLINE=1).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import queue
import threading
import time
import traceback

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

PROTOCOL_VERSION = 1
WORKER_VERSION = "1.0.0"
SUPPORTED_MODELS = {"qwen3-vl-embedding-2b"}

_state = {"embedder": None, "model_id": None, "cancel": set(), "busy": False}
_args = None


def log(msg: str) -> None:
    print(f"[worker] {msg}", file=sys.stderr, flush=True)


def send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, allow_nan=False) + "\n")
    sys.stdout.flush()


def fail(req: dict, code: str, message: str, recoverable: bool = True) -> dict:
    return {"protocolVersion": PROTOCOL_VERSION, "requestId": req.get("requestId"), "runId": req.get("runId"), "ok": False, "error": {"code": code, "message": message, "recoverable": recoverable}}


def ok(req: dict, result: dict) -> dict:
    return {"protocolVersion": PROTOCOL_VERSION, "requestId": req.get("requestId"), "runId": req.get("runId"), "ok": True, "result": result}


class WorkerError(Exception):
    def __init__(self, code: str, message: str, recoverable: bool = True):
        super().__init__(message)
        self.code = code
        self.recoverable = recoverable


def inside(path: str, roots: list[str]) -> str:
    """Absoluten, aufgelösten Pfad zurückgeben, wenn er in einer erlaubten Wurzel liegt; sonst Fehler."""
    if not isinstance(path, str) or not path or "\x00" in path:
        raise WorkerError("bad-path", "Ungültiger Pfad")
    real = os.path.realpath(path)
    for r in roots:
        rr = os.path.realpath(r)
        try:
            if os.path.commonpath([real, rr]) == rr:
                return real
        except ValueError:
            continue
    raise WorkerError("path-not-allowed", "Pfad liegt außerhalb der freigegebenen Ordner")


def finite_list(x, name: str, n_max: int) -> list:
    if not isinstance(x, list) or len(x) > n_max:
        raise WorkerError("bad-payload", f"{name}: Liste erwartet (höchstens {n_max})")
    return x


# --------------------------------------------------------------------------------------------------------------------------------- Operationen


def op_health(req, p):
    info = {"worker": WORKER_VERSION, "protocol": PROTOCOL_VERSION, "python": sys.version.split()[0], "loadedModel": _state["model_id"]}
    try:
        import torch

        info["torch"] = torch.__version__
        info["cuda"] = bool(torch.cuda.is_available())
        if info["cuda"]:
            info["gpu"] = torch.cuda.get_device_name(0)
            free, total = torch.cuda.mem_get_info()
            info["vramFreeBytes"], info["vramTotalBytes"] = int(free), int(total)
            info["vramPeakBytes"] = int(torch.cuda.max_memory_allocated())
    except Exception as e:  # noqa: BLE001
        info["torchError"] = str(e)[:200]
    try:
        import transformers

        info["transformers"] = transformers.__version__
    except Exception as e:  # noqa: BLE001
        info["transformersError"] = str(e)[:200]
    return info


def op_capabilities(req, p):
    return {
        "ops": ["health", "capabilities", "load_model", "unload_model", "embed_frames", "embed_text", "cancel", "shutdown"],
        "models": [{"id": m, "role": "visual-semantic-retrieval", "status": "available"} for m in sorted(SUPPORTED_MODELS)],
        "notImplemented": ["temporal_ground", "analyze_av", "select_frames", "rank_candidates"],
    }


def op_load_model(req, p):
    model_id = p.get("modelId")
    if model_id not in SUPPORTED_MODELS:
        raise WorkerError("unknown-model", f"Unbekanntes Modell: {model_id}")
    if _state["embedder"] is not None:
        if _state["model_id"] == model_id:
            return {"modelId": model_id, "alreadyLoaded": True}
        raise WorkerError("model-busy", "Ein anderes Modell ist geladen; zuerst unload_model", True)
    path = inside(p.get("modelDir"), _args.model_root)
    import torch

    if not torch.cuda.is_available():
        raise WorkerError("no-cuda", "Keine CUDA-GPU verfügbar", False)
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
    from qwen3_vl_embedding import Qwen3VLEmbedder  # type: ignore  # vendored, Apache-2.0 (siehe vendor/NOTICE)

    t0 = time.time()
    torch.cuda.reset_peak_memory_stats()
    embedder = Qwen3VLEmbedder(model_name_or_path=path, torch_dtype=torch.bfloat16, attn_implementation="sdpa", fps=float(p.get("fps", 1)), max_frames=int(p.get("maxFrames", 16)))
    _state["embedder"], _state["model_id"] = embedder, model_id
    return {"modelId": model_id, "loadSeconds": round(time.time() - t0, 2), "vramAllocatedBytes": int(torch.cuda.memory_allocated()), "vramPeakBytes": int(torch.cuda.max_memory_allocated())}


def op_unload_model(req, p):
    import gc

    import torch

    _state["embedder"], _state["model_id"] = None, None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
    return {"unloaded": True, "vramAllocatedBytes": int(torch.cuda.memory_allocated()) if torch.cuda.is_available() else 0}


def _need_model():
    if _state["embedder"] is None:
        raise WorkerError("no-model", "Kein Modell geladen")
    return _state["embedder"]


def op_embed_frames(req, p):
    """Fenster aus Einzelbildern → Vektoren. payload: windows=[{id, frames:[Pfade]}], outPath (.npy), instruction?, batchSize?"""
    import numpy as np
    import torch

    emb = _need_model()
    windows = finite_list(p.get("windows"), "windows", 4096)
    out_path = inside(p.get("outPath"), _args.allowed_root)
    if not out_path.endswith(".npy"):
        raise WorkerError("bad-path", "outPath muss auf .npy enden")
    instruction = p.get("instruction") or "Represent the user's input."
    batch = max(1, min(int(p.get("batchSize", 4)), 16))
    items = []
    for w in windows:
        frames = [inside(f, _args.allowed_root) for f in finite_list(w.get("frames"), "frames", 64)]
        if not frames:
            raise WorkerError("bad-payload", "Fenster ohne Bilder")
        items.append({"video": frames, "instruction": instruction})
    vecs = []
    t0 = time.time()
    for i in range(0, len(items), batch):
        if req.get("requestId") in _state["cancel"]:
            raise WorkerError("cancelled", "abgebrochen")
        vecs.append(emb.process(items[i : i + batch]).float().cpu().numpy())
    arr = np.concatenate(vecs, axis=0) if vecs else np.zeros((0, 0), dtype=np.float32)
    if not np.isfinite(arr).all():
        raise WorkerError("bad-output", "Modell lieferte nicht endliche Werte")
    np.save(out_path, arr.astype(np.float16), allow_pickle=False)
    return {"count": int(arr.shape[0]), "dimension": int(arr.shape[1]) if arr.ndim == 2 and arr.shape[0] else 0, "seconds": round(time.time() - t0, 2), "outPath": out_path, "dtype": "float16", "vramPeakBytes": int(torch.cuda.max_memory_allocated())}


def op_embed_text(req, p):
    import numpy as np

    emb = _need_model()
    texts = finite_list(p.get("texts"), "texts", 256)
    if not all(isinstance(t, str) and 0 < len(t) <= 1000 for t in texts):
        raise WorkerError("bad-payload", "texts: nicht leere Strings (≤ 1000 Zeichen)")
    out_path = inside(p.get("outPath"), _args.allowed_root)
    if not out_path.endswith(".npy"):
        raise WorkerError("bad-path", "outPath muss auf .npy enden")
    instruction = p.get("instruction") or "Retrieve video clips relevant to the user's query."
    arr = emb.process([{"text": t, "instruction": instruction} for t in texts]).float().cpu().numpy()
    if not np.isfinite(arr).all():
        raise WorkerError("bad-output", "Modell lieferte nicht endliche Werte")
    np.save(out_path, arr.astype(np.float16), allow_pickle=False)
    return {"count": int(arr.shape[0]), "dimension": int(arr.shape[1]), "outPath": out_path, "dtype": "float16"}


def op_cancel(req, p):
    rid = p.get("targetRequestId")
    if isinstance(rid, str):
        _state["cancel"].add(rid)
    return {"cancelled": rid}


OPS = {"health": op_health, "capabilities": op_capabilities, "load_model": op_load_model, "unload_model": op_unload_model, "embed_frames": op_embed_frames, "embed_text": op_embed_text}


def handle(req: dict) -> dict | None:
    if not isinstance(req, dict) or req.get("protocolVersion") != PROTOCOL_VERSION:
        return fail(req if isinstance(req, dict) else {}, "bad-protocol", "Protokollversion nicht unterstützt", False)
    op = req.get("op")
    payload = req.get("payload") or {}
    if not isinstance(req.get("requestId"), str) or not isinstance(payload, dict):
        return fail(req, "bad-request", "requestId/payload ungültig")
    if op == "shutdown":
        return ok(req, {"bye": True})
    if op == "cancel":
        return ok(req, op_cancel(req, payload))
    fn = OPS.get(op)
    if fn is None:
        return fail(req, "unknown-op", f"Unbekannte Operation: {op}")
    try:
        return ok(req, fn(req, payload))
    except WorkerError as e:
        return fail(req, e.code, str(e), e.recoverable)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        log(traceback.format_exc())
        code = "oom" if "out of memory" in msg.lower() else "internal"
        return fail(req, code, msg[:400], code != "internal")
    finally:
        _state["cancel"].discard(req.get("requestId"))


def main() -> int:
    global _args
    ap = argparse.ArgumentParser()
    ap.add_argument("--allowed-root", action="append", default=[], help="Ordner für Bilder/Vektoren (Projekt-Cache)")
    ap.add_argument("--model-root", action="append", default=[], help="Ordner der Modelle")
    _args = ap.parse_args()
    if not _args.allowed_root or not _args.model_root:
        log("--allowed-root und --model-root sind Pflicht")
        return 2
    for stream in (sys.stdin, sys.stdout):
        stream.reconfigure(encoding="utf-8")
    # Schwere Importe im Hauptthread VOR dem Lesen von stdin: das Laden der numpy-/torch-DLLs aus einem Nebenthread, während der Hauptthread auf
    # stdin wartet, blockiert unter Windows (gemessen). Fehlschläge werden in health gemeldet, nicht verschluckt.
    t0 = time.time()
    for name in ("numpy", "torch"):
        try:
            __import__(name)
        except Exception as e:  # noqa: BLE001
            log(f"Import {name} fehlgeschlagen: {e}")
    log(f"Importe fertig in {time.time() - t0:.1f} s")
    send({"protocolVersion": PROTOCOL_VERSION, "event": "ready", "worker": WORKER_VERSION})

    lock = threading.Lock()
    inbox: "queue.Queue[dict | None]" = queue.Queue()

    def reply(resp: dict) -> None:
        with lock:
            send(resp)

    def reader() -> None:
        """Liest Anfragen. Abbruch und Statusabfragen werden sofort beantwortet, auch während eine lange Operation im Hauptthread läuft."""
        while True:
            line = sys.stdin.readline()
            if not line:
                inbox.put(None)
                return
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except Exception:  # noqa: BLE001
                reply(fail({}, "bad-json", "Ungültiges JSON"))
                continue
            op = req.get("op") if isinstance(req, dict) else None
            if op in ("cancel", "health", "capabilities"):
                reply(handle(req))
            else:
                inbox.put(req)

    threading.Thread(target=reader, daemon=True).start()
    while True:
        req = inbox.get()
        if req is None:
            return 0
        reply(handle(req))
        if req.get("op") == "shutdown":
            return 0


if __name__ == "__main__":
    sys.exit(main())
