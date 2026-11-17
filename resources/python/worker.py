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
# numba (über librosa) will seinen JIT-Cache neben die Pakete schreiben; auf nicht beschreibbaren/umgeleiteten Pfaden wiederholt es das ewig (gemessen: Hänger bei analyze_av)
os.environ.setdefault("NUMBA_CACHE_DIR", os.path.join(os.environ.get("TEMP") or os.path.expanduser("~"), "shortme-numba-cache"))

PROTOCOL_VERSION = 1
WORKER_VERSION = "1.0.0"
EMBED_MODELS = {"qwen3-vl-embedding-2b"}
TEMPORAL_MODELS = {"lighthouse-cg-detr-clip"}
AV_MODELS = {"minicpm-o-4_5"}
AV_MIN_VRAM_BYTES = int(float(os.environ.get("SHORTME_AV_MIN_VRAM_GB", "20")) * 2**30)
SUPPORTED_MODELS = EMBED_MODELS | TEMPORAL_MODELS | AV_MODELS

_state = {"embedder": None, "temporal": None, "av": None, "tokenizer": None, "model_id": None, "cancel": set(), "busy": False}
_args = None


def log(msg: str) -> None:
    print(f"[worker] {msg}", file=sys.stderr, flush=True)


_OUT = None  # Protokoll-Ausgabe (privates Handle, siehe main)
_IN = None  # Protokoll-Eingabe


def send(obj: dict) -> None:
    out = _OUT or sys.stdout
    out.write(json.dumps(obj, ensure_ascii=False, allow_nan=False) + "\n")
    out.flush()


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


def _importable(name: str) -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec(name) is not None
    except Exception:  # noqa: BLE001
        return False


def op_capabilities(req, p):
    """Welche Modelle diese Umgebung wirklich laden kann (aus den installierten Paketen), nicht was der Code theoretisch kennt."""
    ver = ""
    try:
        import transformers

        ver = transformers.__version__
    except Exception:  # noqa: BLE001
        pass
    models = []
    if ver and tuple(int(x) for x in ver.split(".")[:2]) >= (4, 57):
        models.append({"id": "qwen3-vl-embedding-2b", "role": "visual-semantic-retrieval", "status": "available"})
    if _importable("lighthouse") and _importable("clip"):
        models.append({"id": "lighthouse-cg-detr-clip", "role": "temporal-grounding", "status": "available"})
    if ver == "4.51.0" and _importable("minicpmo"):
        models.append({"id": "minicpm-o-4_5", "role": "av-verification", "status": "available"})
    ops = ["health", "capabilities", "load_model", "unload_model", "cancel", "shutdown"]
    if any(m["id"] == "qwen3-vl-embedding-2b" for m in models):
        ops += ["embed_frames", "embed_text"]
    if any(m["id"] == "lighthouse-cg-detr-clip" for m in models):
        ops += ["temporal_ground"]
    if any(m["id"] == "minicpm-o-4_5" for m in models):
        ops += ["analyze_av"]
    return {"ops": ops, "models": models, "notImplemented": ["select_frames", "rank_candidates"]}


def op_load_model(req, p):
    model_id = p.get("modelId")
    if model_id not in SUPPORTED_MODELS:
        raise WorkerError("unknown-model", f"Unbekanntes Modell: {model_id}")
    if _state["model_id"] is not None:
        if _state["model_id"] == model_id:
            return {"modelId": model_id, "alreadyLoaded": True}
        raise WorkerError("model-busy", "Ein anderes Modell ist geladen; zuerst unload_model", True)
    path = inside(p.get("modelDir"), _args.model_root)
    import torch

    if not torch.cuda.is_available():
        raise WorkerError("no-cuda", "Keine CUDA-GPU verfügbar", False)
    if model_id in TEMPORAL_MODELS:
        return _load_temporal(model_id, path)
    if model_id in AV_MODELS:
        return _load_av(model_id, path)
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
    from qwen3_vl_embedding import Qwen3VLEmbedder  # type: ignore  # vendored, Apache-2.0 (siehe vendor/NOTICE)

    t0 = time.time()
    torch.cuda.reset_peak_memory_stats()
    embedder = Qwen3VLEmbedder(model_name_or_path=path, torch_dtype=torch.bfloat16, attn_implementation="sdpa", fps=float(p.get("fps", 1)), max_frames=int(p.get("maxFrames", 16)))
    _state["embedder"], _state["model_id"] = embedder, model_id
    return {"modelId": model_id, "loadSeconds": round(time.time() - t0, 2), "vramAllocatedBytes": int(torch.cuda.memory_allocated()), "vramPeakBytes": int(torch.cuda.max_memory_allocated())}


def _load_temporal(model_id: str, path: str) -> dict:
    """Lighthouse (LY Corp., Apache-2.0) mit CG-DETR + CLIP-ViT-B/32-Features. Checkpoint (Zenodo 13960580, CC-BY-4.0) und CLIP-Gewicht liegen im Modellordner;
    clip.load prüft die SHA-256 der vorhandenen Datei und lädt nichts nach, solange sie da ist."""
    import functools

    import torch

    ckpt = os.path.join(path, "clip_cg_detr_qvhighlight.ckpt")
    if not os.path.isfile(ckpt) or not os.path.isfile(os.path.join(path, "ViT-B-32.pt")):
        raise WorkerError("model-files-missing", "Lighthouse-Checkpoint oder CLIP-Gewicht fehlt im Modellordner", False)
    import clip  # type: ignore

    if not getattr(clip.load, "_shortme", False):
        orig = clip.load
        patched = functools.partial(orig, download_root=path)
        patched._shortme = True  # type: ignore[attr-defined]
        clip.load = patched  # type: ignore[assignment]
    from lighthouse.models import CGDETRPredictor  # type: ignore

    t0 = time.time()
    torch.cuda.reset_peak_memory_stats()
    # torch.load(weights_only=False) liegt in Lighthouse: Pickle! Nur der geprüfte Checkpoint (MD5 laut Zenodo, SHA-256 im Katalog) darf hierher.
    _state["temporal"] = CGDETRPredictor(ckpt, device="cuda", feature_name="clip", slowfast_path=None, pann_path=None)
    _state["model_id"] = model_id
    return {"modelId": model_id, "loadSeconds": round(time.time() - t0, 2), "vramAllocatedBytes": int(torch.cuda.memory_allocated()), "vramPeakBytes": int(torch.cuda.max_memory_allocated())}


def _load_av(model_id: str, path: str) -> dict:
    """MiniCPM-o 4.5 (OpenBMB, Apache-2.0): Video + Audio, ohne TTS. trust_remote_code führt den Modellcode aus dem fest gepinnten Snapshot aus."""
    import torch
    from transformers import AutoModel, AutoTokenizer  # type: ignore

    # bf16-Gewichte belegen 18,1 GB (gemessen); kleinere GPUs lagern unter Windows still in den RAM aus (stundenlang) → klar abbrechen
    total = torch.cuda.mem_get_info()[1]
    if total < AV_MIN_VRAM_BYTES:
        raise WorkerError("insufficient-vram", f"MiniCPM-o braucht mindestens {AV_MIN_VRAM_BYTES / 2**30:.0f} GB Grafikspeicher, diese GPU hat {total / 2**30:.1f} GB", False)
    t0 = time.time()
    torch.cuda.reset_peak_memory_stats()
    model = AutoModel.from_pretrained(path, trust_remote_code=True, attn_implementation="sdpa", torch_dtype=torch.bfloat16, init_vision=True, init_audio=True, init_tts=False, local_files_only=True)
    _state["av"] = model.eval().cuda()
    _state["tokenizer"] = AutoTokenizer.from_pretrained(path, trust_remote_code=True, local_files_only=True)
    _state["model_id"] = model_id
    return {"modelId": model_id, "loadSeconds": round(time.time() - t0, 2), "vramAllocatedBytes": int(torch.cuda.memory_allocated()), "vramPeakBytes": int(torch.cuda.max_memory_allocated())}


def op_unload_model(req, p):
    import gc

    import torch

    _state["embedder"], _state["temporal"], _state["av"], _state["tokenizer"], _state["model_id"] = None, None, None, None, None
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


def op_temporal_ground(req, p):
    """Lighthouse über kurze Fenster (≤ 150 s, vom Aufrufer zugeschnitten). payload: windows=[{path, startSec}], queries=[str].
    Antwort je Fenster/Anfrage: Momente [start, ende, Wert] in QUELLsekunden und Saliency je Clip-Schritt. Werte gelten nur innerhalb dieses Modells (nicht kalibriert)."""
    import torch

    m = _state["temporal"]
    if m is None:
        raise WorkerError("no-model", "Kein Temporal-Modell geladen")
    windows = finite_list(p.get("windows"), "windows", 256)
    queries = finite_list(p.get("queries"), "queries", 32)
    if not all(isinstance(q, str) and 0 < len(q) <= 300 for q in queries):
        raise WorkerError("bad-payload", "queries: nicht leere Strings (≤ 300 Zeichen)")
    out = []
    t0 = time.time()
    for w in windows:
        if req.get("requestId") in _state["cancel"]:
            raise WorkerError("cancelled", "abgebrochen")
        path = inside(w.get("path"), _args.allowed_root)
        start = float(w.get("startSec"))
        video = m.encode_video(path)
        per_q = []
        for q in queries:
            pred = m.predict(q, video)
            moments = [[round(start + float(a), 2), round(start + float(b), 2), round(float(c), 4)] for a, b, c in pred.get("pred_relevant_windows", [])[:6]]
            sal = [round(float(x), 3) for x in pred.get("pred_saliency_scores", [])]
            per_q.append({"query": q, "moments": moments, "saliency": sal})
        out.append({"startSec": start, "clipLength": float(getattr(m, "_clip_len", 2.0)), "queries": per_q})
    return {"windows": out, "seconds": round(time.time() - t0, 2), "vramPeakBytes": int(torch.cuda.max_memory_allocated())}


def _has_audio_stream(path: str) -> bool:
    import subprocess

    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path], capture_output=True, text=True, timeout=60)
    return bool(r.stdout.strip())


def _frames_1fps(path: str) -> list:
    """Bilder (1 pro Sekunde) per ffmpeg in einen temporären Ordner, danach als PIL-Bilder (Argumentliste, kein Shell)."""
    import subprocess
    import tempfile

    from PIL import Image

    with tempfile.TemporaryDirectory(prefix="shortme-frames-") as d:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-vf", "fps=1", os.path.join(d, "f%04d.jpg")], check=True, timeout=300)
        out = []
        for name in sorted(os.listdir(d)):
            with Image.open(os.path.join(d, name)) as im:
                out.append(im.convert("RGB"))
        return out


def op_analyze_av(req, p):
    """MiniCPM-o: Video UND Audio eines kurzen Ausschnitts (≤ 60 s, vom Aufrufer zugeschnitten) mit einer Aufgabe. Liefert den Modelltext (wird im Aufrufer gegen ein Schema geprüft)."""
    import torch

    m, tok = _state["av"], _state["tokenizer"]
    if m is None:
        raise WorkerError("no-model", "Kein AV-Modell geladen")
    path = inside(p.get("path"), _args.allowed_root)
    prompt = p.get("prompt")
    if not isinstance(prompt, str) or not 0 < len(prompt) <= 8000:
        raise WorkerError("bad-payload", "prompt: String (≤ 8000 Zeichen)")
    max_new = max(16, min(int(p.get("maxNewTokens", 300)), 600))
    from minicpmo.utils import get_video_frame_audio_segments  # type: ignore

    t0 = time.time()
    if _has_audio_stream(path):
        frames, audio_chunks, _ = get_video_frame_audio_segments(path, stack_frames=1, use_ffmpeg=True)
    else:
        # Datei ohne Tonspur: nur Bilder (1/s); die Hilfsfunktion von MiniCPM-o scheitert sonst am Tonauszug
        frames, audio_chunks = _frames_1fps(path), []
    if not frames or len(frames) > 75:
        raise WorkerError("bad-media", f"Ausschnitt hat {len(frames)} Sekunden (erlaubt 1–75)")
    contents = []
    has_audio = bool(audio_chunks) and len(audio_chunks) == len(frames)
    for i, f in enumerate(frames):
        contents += [f, audio_chunks[i]] if has_audio else [f]  # ohne Tonspur nur Bilder, kein erfundener Ton
    msgs = [{"role": "user", "content": contents + [prompt]}]
    torch.cuda.reset_peak_memory_stats()
    # inference_mode: ohne ihn behielt MiniCPM-o Zwischenwerte, der VRAM wuchs je Aufruf bis zur Auslagerung (gemessen: 32 GB voll nach 8 Aufrufen)
    with torch.inference_mode():
        temp = float(p.get("temperature", 0) or 0)
        # Wiederholung nach ungültiger Antwort mit leichter Streuung: bei do_sample=False käme exakt dieselbe Antwort zurück
        sampling = {"do_sample": True, "temperature": min(max(temp, 0.05), 1.0), "top_p": 0.9} if temp > 0 else {"do_sample": False}
        text = m.chat(msgs=msgs, tokenizer=tok, omni_mode=has_audio, max_slice_nums=1, use_tts_template=False, max_new_tokens=max_new, **sampling)
    peak = int(torch.cuda.max_memory_allocated())
    del msgs, contents, frames, audio_chunks
    import gc

    gc.collect()
    torch.cuda.empty_cache()
    return {"text": text if isinstance(text, str) else str(text), "seconds": round(time.time() - t0, 2), "hasAudio": has_audio, "vramPeakBytes": peak, "vramAllocatedBytes": int(torch.cuda.memory_allocated())}


def op_cancel(req, p):
    rid = p.get("targetRequestId")
    if isinstance(rid, str):
        _state["cancel"].add(rid)
    return {"cancelled": rid}


OPS = {"health": op_health, "capabilities": op_capabilities, "load_model": op_load_model, "unload_model": op_unload_model, "embed_frames": op_embed_frames, "embed_text": op_embed_text, "temporal_ground": op_temporal_ground, "analyze_av": op_analyze_av}


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
    # Protokoll-Pipes auf private Handles legen und fd 0/1 umleiten: Kindprozesse (z. B. das ffmpeg von Lighthouse) erben sonst stdin und
    # fressen Anfragezeilen bzw. schreiben in den Protokollstrom (gemessen: Worker hing bei temporal_ground).
    global _OUT, _IN
    _IN = os.fdopen(os.dup(0), "r", encoding="utf-8", newline="\n")
    _OUT = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.dup2(2, 1)
    sys.stdin = open(os.devnull, "r")
    if os.environ.get("SHORTME_WORKER_DEBUG"):
        import faulthandler

        faulthandler.dump_traceback_later(20, repeat=True, file=sys.stderr)  # Diagnose: wo hängt der Worker?
    # Schwere Importe im Hauptthread VOR dem Lesen von stdin: das Laden der numpy-/torch-DLLs aus einem Nebenthread, während der Hauptthread auf
    # stdin wartet, blockiert unter Windows (gemessen). Fehlschläge werden in health gemeldet, nicht verschluckt.
    t0 = time.time()
    # auch die Pakete der AV-Umgebung (nur wenn installiert): sonst laden ihre DLLs später im Hauptthread, während der Leser-Thread auf stdin blockiert
    for name in ("numpy", "torch", "transformers", "scipy", "librosa", "clip", "lighthouse.models", "minicpmo.utils"):
        try:
            __import__(name)
        except Exception as e:  # noqa: BLE001
            if name in ("numpy", "torch"):
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
            line = _IN.readline()
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
