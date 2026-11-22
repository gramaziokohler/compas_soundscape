"""GPU <-> system RAM offload of a resident generation model: memory freed, time, output unchanged.

Strategy under test: when the PFFDTD wave solver needs the GPU memory, the worker moves its model's
weights to system RAM (utils.gpu_offload.move_model, process and model stay alive) instead of
unloading it, and moves them back before the next generation.

Models:
  sa3    Stable Audio 3 small-sfx, run in the compas-sa3 env. The weights are a gated Hugging Face
         repo: the user running this needs a Hugging Face login with access.
  proxy  flan-t5-large in fp16 (backend/data/models, TangoFlux's text encoder) arranged like SA3: the decoder registered,
         the encoder hidden in a conditioner's __dict__ like T5GemmaConditioner. Checks the
         mechanics (a plain .to("cpu") leaves the hidden encoder on the GPU) on any machine.

For each: GPU memory (nvidia-smi, whole GPU) loaded -> offloaded (naive .to and move_model) ->
restored (this process's dedicated GPU memory), the time of each move, and whether the output after the round trip is bit-identical.

    python -m tests.benchmarks.gpu_offload.run_offload --model proxy     (from backend/)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[3]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import torch  # noqa: E402

from utils.gpu_offload import cuda_bytes_on, move_model  # noqa: E402

GB = 1e9


COUNTER_LAG_S = 1.5   # the Windows GPU memory counter trails a free/alloc by about a second


def gpu_used_mib() -> int:
    """This process's dedicated GPU memory (Windows GPU counters; nvidia-smi cannot attribute it under WDDM)."""
    time.sleep(COUNTER_LAG_S)
    ps = (f"((Get-Counter '\GPU Process Memory(pid_{os.getpid()}*)\Dedicated Usage').CounterSamples"
          " | Measure-Object CookedValue -Sum).Sum")
    out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True).stdout.strip()
    return int(round(float(out or 0) / 2 ** 20))


def timed(fn):
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    r = fn()
    torch.cuda.synchronize()
    return r, time.perf_counter() - t0


# ---------------------------------------------------------------- proxy (flan-t5-large, SA3 layout)

class _HiddenConditioner(torch.nn.Module):
    """Like T5GemmaConditioner: the text encoder lives in __dict__, moved to the device on first use."""

    def __init__(self, encoder):
        super().__init__()
        self.proj_out = torch.nn.Identity()
        self.__dict__["model"] = encoder
        self._device_initialized = False

    def forward(self, ids, device):
        if not self._device_initialized:
            self.model.to(device)
            self._device_initialized = True
        return self.model(input_ids=ids.to(device)).last_hidden_state


class _Proxy(torch.nn.Module):
    def __init__(self, t5):
        super().__init__()
        self.conditioner = _HiddenConditioner(t5.encoder)
        self.decoder = t5.decoder
        self.lm_head = t5.lm_head

    @torch.inference_mode()   # like SA3's generate: no autograd graph (it would keep the GPU weights alive)
    def run(self, ids):
        enc = self.conditioner(ids, "cuda")
        dec_ids = torch.zeros((ids.shape[0], 8), dtype=torch.long, device="cuda")
        out = self.decoder(input_ids=dec_ids, encoder_hidden_states=enc).last_hidden_state
        return self.lm_head(out).float().cpu()


def load_proxy():
    from transformers import AutoTokenizer, T5ForConditionalGeneration

    src = _BACKEND / "data" / "models" / "flan-t5-large"   # TangoFlux's text encoder, local copy
    tok = AutoTokenizer.from_pretrained(src)
    t5 = T5ForConditionalGeneration.from_pretrained(src, torch_dtype=torch.float16)
    model = _Proxy(t5).to("cuda")
    ids = tok(["rain on a tin roof with distant thunder"], return_tensors="pt").input_ids
    return model, lambda: model.run(ids)


# ---------------------------------------------------------------- Stable Audio 3

def load_sa3():
    from stable_audio_3 import StableAudioModel

    sa = StableAudioModel.from_pretrained("small-sfx")

    def gen():
        audio = sa.generate(prompt="rain on a tin roof", negative_prompt=None, duration=5.0, steps=25,
                            cfg_scale=0.9, seed=1, duration_padding_sec=6.0, truncate_output_to_duration=True,
                            disable_tqdm=True)
        return audio.float().cpu()

    return sa.model, gen


def run(model_name: str) -> dict:
    base = gpu_used_mib()
    (root, gen), t_load = timed(load_proxy if model_name == "proxy" else load_sa3)
    ref, t_gen = timed(gen)          # first use also moves hidden modules to the GPU
    again = gen()                    # run-to-run difference without any move (GPU kernels may be nondeterministic)
    torch.cuda.empty_cache()
    loaded = gpu_used_mib()
    res = {"model": model_name, "torch_reserved_loaded_mib": torch.cuda.memory_reserved() / 2 ** 20, "load_s": t_load, "first_output_s": t_gen,
           "loaded_mib": loaded - base, "weights_on_gpu_gb": cuda_bytes_on(root) / GB,
           "weights_registered_gb": cuda_bytes_on(root, include_hidden=False) / GB}

    # naive: root.to("cpu") (hidden modules stay)
    _, t = timed(lambda: root.to("cpu"))
    torch.cuda.empty_cache()
    res["naive_offload"] = {"s": t, "freed_mib": loaded - gpu_used_mib(), "left_on_gpu_gb": cuda_bytes_on(root) / GB}
    root.to("cuda")
    torch.cuda.synchronize()

    # move_model: hidden modules too
    n_hidden, t_off = timed(lambda: move_model(root, "cpu"))
    off = gpu_used_mib()
    res["offload"] = {"s": t_off, "hidden_modules": n_hidden, "freed_mib": loaded - off,
                      "torch_reserved_mib": torch.cuda.memory_reserved() / 2 ** 20,
                      "left_on_gpu_gb": cuda_bytes_on(root) / GB, "process_left_mib": off - base}
    _, t_on = timed(lambda: move_model(root, "cuda"))
    res["restore"] = {"s": t_on, "gb_per_s": res["weights_on_gpu_gb"] / t_on}
    out, t_gen2 = timed(gen)
    res["output_after_restore_s"] = t_gen2
    res["identical_output"] = bool(torch.equal(out, ref))
    res["max_abs_diff"] = float((out - ref).abs().max())
    res["baseline_max_abs_diff"] = float((again - ref).abs().max())
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["proxy", "sa3"], default="proxy")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    res = run(a.model)
    text = json.dumps(res, indent=1)
    print(text)
    if a.out:
        a.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
