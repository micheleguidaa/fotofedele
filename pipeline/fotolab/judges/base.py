"""Shared judge protocol: blind A/B pair, anchored rubric, symmetric content-difference checklist.

The same prompt and JSON schema go to every judge backend (GPT via Codex, Gemma/Qwen via
Ollama). Order is randomised per call and recorded, so position bias can be measured and
cancelled by asking both orders.
"""

from __future__ import annotations

import base64
import io
import json
from dataclasses import dataclass

import numpy as np
from PIL import Image

from fotolab import CONFIG

CRITERIA = ["esposizione", "colore", "geometria", "nitidezza", "naturalezza", "attrattivita"]
CHECKS = ["oggetti_aggiunti_rimossi", "finestre_vista_cambiata", "materiali_colori_cambiati",
          "geometria_stanza_alterata", "difetti_nascosti", "testi_loghi_alterati"]

_rubric = {"type": "object", "additionalProperties": False, "required": CRITERIA,
           "properties": {c: {"type": "integer", "minimum": 1, "maximum": 5} for c in CRITERIA}}
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["rubric_A", "rubric_B", "preferenza", "differenze", "note"],
    "properties": {
        "rubric_A": _rubric,
        "rubric_B": _rubric,
        "preferenza": {"type": "string", "enum": ["A", "B", "pari"]},
        "differenze": {"type": "object", "additionalProperties": False, "required": CHECKS,
                       "properties": {c: {"type": "boolean"} for c in CHECKS}},
        "note": {"type": "string"},
    },
}

JUDGES = {
    "gpt": {"name": "GPT (Codex, abbonamento ChatGPT)", "family": "openai", "backend": "codex"},
    "gemma": {"name": "Gemma 4 31B (open weights, Google)", "family": "google", "backend": "ollama", "model": "gemma4:31b"},
    "qwen": {"name": "Qwen 3.8 27B VL (open weights, Alibaba)", "family": "alibaba", "backend": "ollama", "model": "qwen3.8:27b"},
}


def prompt() -> str:
    return (CONFIG / "prompts" / "judge_pair.md").read_text()


@dataclass
class Pair:
    pair_id: str          # e.g. "R01:F3", "GT:D01", "TRAP:T03"
    input_path: str       # the "before" / reference image
    output_path: str      # the "after" / candidate image
    kind: str             # "output" | "gt" | "trap"


def encode_jpeg(path: str, max_side: int = 1024) -> bytes:
    im = Image.open(path).convert("RGB")
    im.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def b64(path: str) -> str:
    return base64.b64encode(encode_jpeg(path)).decode()


def validate(obj: dict) -> dict:
    """Coerce/validate a judge answer; raises on malformed output."""
    for side in ("rubric_A", "rubric_B"):
        obj[side] = {c: int(np.clip(int(obj[side][c]), 1, 5)) for c in CRITERIA}
    if obj["preferenza"] not in ("A", "B", "pari"):
        raise ValueError(f"bad preferenza {obj['preferenza']}")
    obj["differenze"] = {c: bool(obj["differenze"][c]) for c in CHECKS}
    obj["note"] = str(obj.get("note", ""))[:400]
    return obj


def parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):]
    start, end = text.find("{"), text.rfind("}")
    return validate(json.loads(text[start:end + 1]))


def to_roles(ans: dict, input_first: bool) -> dict:
    """Map A/B answer back to input/output roles."""
    a_is_input = input_first
    pref = ans["preferenza"]
    preferred = "tie" if pref == "pari" else ("input" if (pref == "A") == a_is_input else "output")
    return {
        "preferred": preferred,
        "rubric_input": ans["rubric_A"] if a_is_input else ans["rubric_B"],
        "rubric_output": ans["rubric_B"] if a_is_input else ans["rubric_A"],
        "checklist": ans["differenze"],
        "notes": ans["note"],
    }
