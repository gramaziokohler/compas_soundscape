"""Move a resident model between GPU and system RAM (stateless helpers; torch imported lazily).

``module.to(device)`` only moves modules registered in the module tree. Some wrappers keep a
submodule out of it on purpose, e.g. Stable Audio 3's T5GemmaConditioner stores its text encoder
as ``self.__dict__["model"]`` (no state_dict entry) and moves it to the GPU once, on its first
forward. ``move_model`` therefore also moves every ``torch.nn.Module`` found in a module's
``__dict__`` outside ``_modules``.
"""
from __future__ import annotations

import gc
from typing import Any, Iterator


def _hidden_modules(root: Any) -> Iterator[Any]:
    """nn.Modules referenced from a module's __dict__ but not registered as submodules."""
    import torch

    seen: set[int] = set()
    for m in root.modules():
        for name, value in vars(m).items():
            if name.startswith("_") or not isinstance(value, torch.nn.Module):
                continue
            if any(value is sub for sub in m._modules.values()) or id(value) in seen:
                continue
            seen.add(id(value))
            yield value


def move_model(root: Any, device: str) -> int:
    """Move ``root`` and its hidden submodules to ``device``. Returns the number of hidden modules moved."""
    import torch

    hidden = list(_hidden_modules(root))
    root.to(device)
    for h in hidden:
        h.to(device)
    if device == "cpu":
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    elif torch.cuda.is_available():
        torch.cuda.synchronize()
    return len(hidden)


def cuda_bytes_on(root: Any, include_hidden: bool = True) -> int:
    """Bytes of parameters and buffers of ``root`` (and its hidden submodules) that live on a CUDA device."""
    mods = [root] + (list(_hidden_modules(root)) if include_hidden else [])
    total = 0
    seen: set[int] = set()
    for mod in mods:
        for t in list(mod.parameters()) + list(mod.buffers()):
            if t.is_cuda and id(t) not in seen:
                seen.add(id(t))
                total += t.numel() * t.element_size()
    return total
