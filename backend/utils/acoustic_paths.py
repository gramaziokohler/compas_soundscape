"""Stateless helpers of the sound-paths document a run stores (services/acoustic_paths_service.py)."""

from __future__ import annotations

from typing import Callable, Optional

_KINDS = ("reflections", "diffraction")


def merge_paths_docs(docs: list[dict]) -> dict:
    """One document from those of a run's groups / processes (disjoint pairs): sources and listeners
    joined by id, path indices remapped, notes kept once."""
    out: dict = {"speed_of_sound": docs[0]["speed_of_sound"], "sources": [], "receivers": [], "notes": []}
    index: dict[str, dict[str, int]] = {"sources": {}, "receivers": {}}
    for doc in docs:
        remap = {}
        for role in ("sources", "receivers"):
            remap[role] = []
            for item in doc.get(role) or []:
                if item["id"] not in index[role]:
                    index[role][item["id"]] = len(out[role])
                    out[role].append(item)
                remap[role].append(index[role][item["id"]])
        for note in doc.get("notes") or []:
            if note not in out["notes"]:
                out["notes"].append(note)
        for kind in _KINDS:
            block = doc.get(kind)
            if block is None:
                continue
            target = out.setdefault(kind, {**{k: v for k, v in block.items() if k != "paths"}, "paths": []})
            target["paths"].extend(
                {**p, "s": remap["sources"][p["s"]], "r": remap["receivers"][p["r"]]} for p in block.get("paths") or []
            )
    for kind in _KINDS:
        if kind in out:
            out[kind]["paths"].sort(key=lambda p: p["delay_ms"])
    return out


def filter_paths_receivers(doc: Optional[dict], allowed: Callable[[str], bool]) -> Optional[dict]:
    """``doc`` with only the listeners ``allowed`` keeps (and their paths), indices remapped."""
    if not doc:
        return doc
    receivers = doc.get("receivers") or []
    remap = {}
    for old, receiver in enumerate(receivers):
        if allowed(str(receiver.get("id") or "")):
            remap[old] = len(remap)
    out = {**doc, "receivers": [receivers[i] for i in remap]}
    for kind in ("reflections", "diffraction"):
        block = doc.get(kind)
        if block:
            out[kind] = {**block, "paths": [{**p, "r": remap[p["r"]]} for p in block.get("paths") or [] if p.get("r") in remap]}
    return out
