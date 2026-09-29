---
name: stabilityai-stable-audio-3
description: Use the stabilityai/stable-audio-3 Gradio Space via API. Provides Python, JavaScript, and cURL usage examples.
---

# stabilityai/stable-audio-3

This skill describes how to use the stabilityai/stable-audio-3 Gradio Space programmatically.

## API Endpoints

### `/_variant_change_simple`

**Parameters:**

- `variant_key` [Radio]: `Literal['medium', 'small-music', 'small-sfx']`, default: `medium`

**Returns:**

- `Duration (s) · model max 380s` [Slider]: `float`
- `Prompt` [Textbox]: `str`

**Python:**

```python
from gradio_client import Client

client = Client("stabilityai/stable-audio-3")
result = client.predict(
	variant_key="medium",
	api_name="/_variant_change_simple",
)
print(result)
```

**JavaScript:**

```javascript
import { Client } from "@gradio/client";

const client = await Client.connect("stabilityai/stable-audio-3");
const result = await client.predict("/_variant_change_simple", {
		variant_key: "medium",
});

console.log(result.data);
```

**cURL:**

```bash
curl -X POST https://stabilityai-stable-audio-3.hf.space/call/v2/_variant_change_simple -s -H "Content-Type: application/json" \
  -d '{"variant_key": "medium"}' \
  | awk -F'"' '{ print $4}' \
  | read EVENT_ID; curl -N https://stabilityai-stable-audio-3.hf.space/call/_variant_change_simple/$EVENT_ID
```

### `/infer`

**Parameters:**

- `variant_key` [Radio]: `Literal['medium', 'small-music', 'small-sfx']`, default: `medium`
- `prompt` [Textbox]: `str` (required)
- `duration` [Slider]: `float`, default: `60`
- `steps` [Slider]: `float`, default: `8`
- `cfg_scale` [Slider]: `float`, default: `1.0`
- `sampler_type` [Dropdown]: `Literal['pingpong', 'euler', 'rk4', 'dpmpp']`, default: `pingpong`
- `seed` [Number]: `int`, default: `0`

**Returns:**

- `Output` [Audio]: `filepath`

**Python:**

```python
from gradio_client import Client

client = Client("stabilityai/stable-audio-3")
result = client.predict(
	variant_key="medium",
	prompt="Hello!!",
	duration=60,
	steps=8,
	cfg_scale=1.0,
	sampler_type="pingpong",
	seed=0,
	api_name="/infer",
)
print(result)
```

**JavaScript:**

```javascript
import { Client } from "@gradio/client";

const client = await Client.connect("stabilityai/stable-audio-3");
const result = await client.predict("/infer", {
		variant_key: "medium",
		prompt: "Hello!!",
		duration: 60,
		steps: 8,
		cfg_scale: 1.0,
		sampler_type: "pingpong",
		seed: 0,
});

console.log(result.data);
```

**cURL:**

```bash
curl -X POST https://stabilityai-stable-audio-3.hf.space/call/v2/infer -s -H "Content-Type: application/json" \
  -d '{"variant_key": "medium", "prompt": "Hello!!", "duration": 60, "steps": 8, "cfg_scale": 1.0, "sampler_type": "pingpong", "seed": 0}' \
  | awk -F'"' '{ print $4}' \
  | read EVENT_ID; curl -N https://stabilityai-stable-audio-3.hf.space/call/infer/$EVENT_ID
```

### `/lambda`

**Parameters:**

- `a` [Audio]: `filepath` (required)

**Returns:**

- `Init audio` [Audio]: `filepath`

**Python:**

```python
from gradio_client import Client, handle_file

client = Client("stabilityai/stable-audio-3")
result = client.predict(
	a=handle_file('https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav'),
	api_name="/lambda",
)
print(result)
```

**JavaScript:**

```javascript
import { Client, handle_file } from "@gradio/client";

const response_0 = await fetch("https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav");
const exampleAudio = await response_0.blob();

const client = await Client.connect("stabilityai/stable-audio-3");
const result = await client.predict("/lambda", {
		a: handle_file(exampleAudio),
});

console.log(result.data);
```

**cURL:**

```bash
FILE_PATH=$(curl -s -X POST https://stabilityai-stable-audio-3.hf.space/upload -F 'files=@/path/to/your/file' | tr -d '[]" ')

curl -X POST https://stabilityai-stable-audio-3.hf.space/call/v2/lambda -s -H "Content-Type: application/json" \
  -d '{"a": {"path": "'$FILE_PATH'", "meta": {"_type": "gradio.FileData"}}}' \
  | awk -F'"' '{ print $4}' \
  | read EVENT_ID; curl -N https://stabilityai-stable-audio-3.hf.space/call/lambda/$EVENT_ID
```

### `/lambda_1`

**Parameters:**

- `a` [Audio]: `filepath` (required)

**Returns:**

- `Inpaint audio` [Audio]: `filepath`

**Python:**

```python
from gradio_client import Client, handle_file

client = Client("stabilityai/stable-audio-3")
result = client.predict(
	a=handle_file('https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav'),
	api_name="/lambda_1",
)
print(result)
```

**JavaScript:**

```javascript
import { Client, handle_file } from "@gradio/client";

const response_0 = await fetch("https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav");
const exampleAudio = await response_0.blob();

const client = await Client.connect("stabilityai/stable-audio-3");
const result = await client.predict("/lambda_1", {
		a: handle_file(exampleAudio),
});

console.log(result.data);
```

**cURL:**

```bash
FILE_PATH=$(curl -s -X POST https://stabilityai-stable-audio-3.hf.space/upload -F 'files=@/path/to/your/file' | tr -d '[]" ')

curl -X POST https://stabilityai-stable-audio-3.hf.space/call/v2/lambda_1 -s -H "Content-Type: application/json" \
  -d '{"a": {"path": "'$FILE_PATH'", "meta": {"_type": "gradio.FileData"}}}' \
  | awk -F'"' '{ print $4}' \
  | read EVENT_ID; curl -N https://stabilityai-stable-audio-3.hf.space/call/lambda_1/$EVENT_ID
```

### `/_update_mask_max`

**Parameters:**

- `seconds_total` [Slider]: `float`, default: `60`

**Returns:**

- `Mask start (sec)` [Slider]: `float`
- `Mask end (sec)` [Slider]: `float`

**Python:**

```python
from gradio_client import Client

client = Client("stabilityai/stable-audio-3")
result = client.predict(
	seconds_total=60,
	api_name="/_update_mask_max",
)
print(result)
```

**JavaScript:**

```javascript
import { Client } from "@gradio/client";

const client = await Client.connect("stabilityai/stable-audio-3");
const result = await client.predict("/_update_mask_max", {
		seconds_total: 60,
});

console.log(result.data);
```

**cURL:**

```bash
curl -X POST https://stabilityai-stable-audio-3.hf.space/call/v2/_update_mask_max -s -H "Content-Type: application/json" \
  -d '{"seconds_total": 60}' \
  | awk -F'"' '{ print $4}' \
  | read EVENT_ID; curl -N https://stabilityai-stable-audio-3.hf.space/call/_update_mask_max/$EVENT_ID
```

### `/_variant_change_advanced`

**Parameters:**

- `variant_key` [Radio]: `Literal['medium', 'small-music', 'small-sfx']`, default: `medium`

**Returns:**

- `Seconds total · model max 380s` [Slider]: `float`
- `value_25` [Textbox]: `str`
- `Mask start (sec)` [Slider]: `float`
- `Mask end (sec)` [Slider]: `float`

**Python:**

```python
from gradio_client import Client

client = Client("stabilityai/stable-audio-3")
result = client.predict(
	variant_key="medium",
	api_name="/_variant_change_advanced",
)
print(result)
```

**JavaScript:**

```javascript
import { Client } from "@gradio/client";

const client = await Client.connect("stabilityai/stable-audio-3");
const result = await client.predict("/_variant_change_advanced", {
		variant_key: "medium",
});

console.log(result.data);
```

**cURL:**

```bash
curl -X POST https://stabilityai-stable-audio-3.hf.space/call/v2/_variant_change_advanced -s -H "Content-Type: application/json" \
  -d '{"variant_key": "medium"}' \
  | awk -F'"' '{ print $4}' \
  | read EVENT_ID; curl -N https://stabilityai-stable-audio-3.hf.space/call/_variant_change_advanced/$EVENT_ID
```

### `/infer_advanced`

**Parameters:**

- `variant_key` [Radio]: `Literal['medium', 'small-music', 'small-sfx']`, default: `medium`
- `prompt` [Textbox]: `str` (required)
- `negative_prompt` [Textbox]: `str` (required)
- `duration` [Slider]: `float`, default: `60`
- `steps` [Slider]: `float`, default: `8`
- `cfg_scale` [Slider]: `float`, default: `1.0`
- `sampler_type` [Dropdown]: `Literal['pingpong', 'euler', 'rk4', 'dpmpp']`, default: `pingpong`
- `seed` [Number]: `int`, default: `-1`
- `sigma_max` [Slider]: `float`, default: `1.0`
- `apg_scale` [Slider]: `float`, default: `1.0`
- `duration_padding_sec` [Slider]: `float`, default: `6.0`
- `cut_to_seconds_total` [Checkbox]: `bool`, default: `True`
- `init_audio` [Audio]: `filepath` (required)
- `init_noise_level` [Slider]: `float`, default: `0.9`
- `inpaint_audio` [Audio]: `filepath` (required)
- `mask_start_sec` [Slider]: `float`, default: `0.0`
- `mask_end_sec` [Slider]: `float`, default: `0.0`
- `preview_every` [Slider]: `float`, default: `0`

**Returns:**

- `Output audio` [Audio]: `filepath`
- `Output spectrogram` [Gallery]: `list[dict(image: filepath, caption: str | None) | dict(video: filepath, caption: str | None)]`

**Python:**

```python
from gradio_client import Client, handle_file

client = Client("stabilityai/stable-audio-3")
result = client.predict(
	variant_key="medium",
	prompt="Hello!!",
	negative_prompt="Hello!!",
	duration=60,
	steps=8,
	cfg_scale=1.0,
	sampler_type="pingpong",
	seed=-1,
	sigma_max=1.0,
	apg_scale=1.0,
	duration_padding_sec=6.0,
	cut_to_seconds_total=True,
	init_audio=handle_file('https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav'),
	init_noise_level=0.9,
	inpaint_audio=handle_file('https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav'),
	mask_start_sec=0.0,
	mask_end_sec=0.0,
	preview_every=0,
	api_name="/infer_advanced",
)
print(result)
```

**JavaScript:**

```javascript
import { Client, handle_file } from "@gradio/client";

const response_0 = await fetch("https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav");
const exampleAudio = await response_0.blob();
const response_1 = await fetch("https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav");
const exampleAudio = await response_1.blob();

const client = await Client.connect("stabilityai/stable-audio-3");
const result = await client.predict("/infer_advanced", {
		variant_key: "medium",
		prompt: "Hello!!",
		negative_prompt: "Hello!!",
		duration: 60,
		steps: 8,
		cfg_scale: 1.0,
		sampler_type: "pingpong",
		seed: -1,
		sigma_max: 1.0,
		apg_scale: 1.0,
		duration_padding_sec: 6.0,
		cut_to_seconds_total: true,
		init_audio: handle_file(exampleAudio),
		init_noise_level: 0.9,
		inpaint_audio: handle_file(exampleAudio),
		mask_start_sec: 0.0,
		mask_end_sec: 0.0,
		preview_every: 0,
});

console.log(result.data);
```

**cURL:**

```bash
FILE_PATH=$(curl -s -X POST https://stabilityai-stable-audio-3.hf.space/upload -F 'files=@/path/to/your/file' | tr -d '[]" ')

curl -X POST https://stabilityai-stable-audio-3.hf.space/call/v2/infer_advanced -s -H "Content-Type: application/json" \
  -d '{"variant_key": "medium", "prompt": "Hello!!", "negative_prompt": "Hello!!", "duration": 60, "steps": 8, "cfg_scale": 1.0, "sampler_type": "pingpong", "seed": -1, "sigma_max": 1.0, "apg_scale": 1.0, "duration_padding_sec": 6.0, "cut_to_seconds_total": true, "init_audio": {"path": "'$FILE_PATH'", "meta": {"_type": "gradio.FileData"}}, "init_noise_level": 0.9, "inpaint_audio": {"path": "'$FILE_PATH'", "meta": {"_type": "gradio.FileData"}}, "mask_start_sec": 0.0, "mask_end_sec": 0.0, "preview_every": 0}' \
  | awk -F'"' '{ print $4}' \
  | read EVENT_ID; curl -N https://stabilityai-stable-audio-3.hf.space/call/infer_advanced/$EVENT_ID
```

