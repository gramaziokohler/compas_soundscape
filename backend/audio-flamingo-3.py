import os
import torch
from huggingface_hub import snapshot_download
from peft import PeftModel
from transformers import AudioFlamingo3ForConditionalGeneration, AutoProcessor

# --- 1. SETUP & AUTHENTICATION ---
model_id = "nvidia/audio-flamingo-3-hf"

# Verify CUDA is available before proceeding
if not torch.cuda.is_available():
    raise RuntimeError("CUDA is not available. A GPU is required to run this model safely.")

DEVICE = "cuda"
# Switch to bfloat16: Native standard for NVIDIA models and immune to the LayerNorm 'Half' crash
DTYPE = torch.bfloat16 

print("Downloading/Locating model...")
local_id = snapshot_download(model_id, token=HF_TOKEN)

# --- 2. LOAD PROCESSOR & BASE MODEL ---
print("Loading processor and base model...")
processor = AutoProcessor.from_pretrained(local_id)

# Load without device_map, utilizing low_cpu_mem_usage to fit it into RAM before moving
model = AudioFlamingo3ForConditionalGeneration.from_pretrained(
    local_id, 
    torch_dtype=DTYPE,
    low_cpu_mem_usage=True 
)

# --- 3. LOAD PEFT ADAPTER ---
print("Applying PEFT adapter...")
model = PeftModel.from_pretrained(
    model, 
    local_id, 
    subfolder="think"
)

# --- 4. FORCE ALIGNMENT TO GPU ---
print("Moving entire architecture to GPU...")
# This completely overrides any rogue CPU placements inside the audio_tower
model = model.to(device=DEVICE, dtype=DTYPE)

# --- 5. LOAD & CAST NON-LORA WEIGHTS ---
print("Injecting custom non-LoRA weights...")
non_lora_path = os.path.join(local_id, "think", "non_lora_trainables.bin")
non_lora_trainables = torch.load(non_lora_path, map_location="cpu", weights_only=True)

# Cast weights to bfloat16 and move to GPU
non_lora_trainables = {
    k: v.to(device=DEVICE, dtype=DTYPE) 
    for k, v in non_lora_trainables.items()
}
model.load_state_dict(non_lora_trainables, strict=False)

# --- 6. PREPARE INPUTS ---
print("Processing audio and prompt...")
conversation = [
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": "Describe all sound events happening and their corresponding timestamps formatted as MM:SS. Example: [Speech] : 00:15 - 00:32, 00:42-1:35 ; [Door closing]: 00:45-00:46 ; ... \nPlease think and reason about the input audio before you respond.",
            },
            {
                "type": "audio",
                "path": "C:/Users/tbouizargan/Downloads/rqe_fake_meeting_mono.wav",
            },
        ],
    }
]

inputs = processor.apply_chat_template(
    conversation,
    tokenize=True,
    add_generation_prompt=True,
    return_dict=True,
)

# Move inputs to CUDA. Cast ONLY floating point tensors (audio) to bfloat16.
inputs = {
    k: v.to(device=DEVICE, dtype=DTYPE) if v.is_floating_point() else v.to(device=DEVICE)
    for k, v in inputs.items()
}

# --- 7. GENERATION ---
print("Generating output... (This may take a moment)")
with torch.inference_mode(): 
    outputs = model.generate(**inputs, max_new_tokens=1024)

# --- 8. DECODE & PRINT ---
decoded_outputs = processor.batch_decode(
    outputs[:, inputs["input_ids"].shape[1]:], 
    skip_special_tokens=True
)

print("\n" + "="*40)
print("OUTPUT:")
print("="*40)
print(decoded_outputs[0])