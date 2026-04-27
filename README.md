# COMPAS Soundscape
<img src=".\compas-soundscape-cover.png" alt="App cover" width="800">

A web application for populating architectural models with contextualized sounds, enabling acoustic simulation and spatial audio rendering. Load 3D models via Speckle, assign acoustic materials, simulate room acoustics, and generate immersive soundscapes with AI-powered audio.

## Prerequisites

- **Python 3.11** (recommended using Conda)
- **CUDA 12.1** (for GPU-accelerated audio generation with PyTorch)
- **Node.js 18+** and **npm** (or pnpm)


## Installation

### 1. Clone the Repository

```bash
pip install git+https://https://github.com/gramaziokohler/compas_soundscape.git
cd compas_soundscape
```

### 2. Backend Setup

```bash
# Create and activate the Mamba/Conda environment
conda create -n compas-soundscape python=3.11 -c conda-forge
conda activate compas-soundscape

# ---> Path 1 (recommended): Install uv for faster dependencies check
pip install uv
uv pip install -r requirements.txt --index-strategy unsafe-best-match

# ---> Path 2: Install dependencies with pip
pip install -r requirements.txt

# (optional) Install your favorite LLM API. You will need s
pip install google-genai
# or / and
pip install anthropic openai
# or / and
pip install openai    

```

### 3. Frontend Setup

```bash
cd frontend
npm install
```


## Running the Application

Start both servers in separate terminals:

**Terminal 1 - Backend:**

```bash
conda activate compas-soundscape
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend API runs at: `http://localhost:8000`

**Terminal 2 - Frontend:**

```bash
cd frontend
npm run dev
```

Frontend runs at: `http://localhost:3000`


## API Keys

| Key | Purpose | Get it from |
|-----|---------|-------------|
| `SPECKLE_TOKEN` | Speckle 3D model platform access | [Speckle Account](https://app.speckle.systems/) |

See the [Speckle authentication guide](https://docs.speckle.systems/developers/sdks/python/getting-started/authentication) for token setup.

### Optional API Keys (LLM providers)

At least one LLM package must be installed (see Backend Setup) to use text/prompt generation. Keys can be set two ways:

**Option A — fill in the `.env` file** (at your local folder root):
```env
GOOGLE_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

**Option B — Advanced Settings panel** in the app (no restart needed).

<img src=".\compas-soundscape-api-keys.png" alt="App cover" width="300">

**Links (Choose your prefered provider)**

| Key | Provider | Get it from |
|-----|----------|-------------|
| `GOOGLE_API_KEY` | Google Gemini | [Google AI Studio](https://aistudio.google.com/apikey) |
| `OPENAI_API_KEY` | ChatGPT (GPT-4o) | [OpenAI Platform](https://platform.openai.com/api-keys) |
| `ANTHROPIC_API_KEY` | Claude 3.5 Sonnet | [Anthropic Console](https://console.anthropic.com/) |




## Project Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full project structure and architecture diagrams.

```
compas_soundscape/
├── backend/            # FastAPI server (routers, services, utils)
├── frontend/           # Next.js app (components, hooks, lib, contexts)
├── ARCHITECTURE.md     # Detailed architecture & file tree
└── requirements.txt    # dependencies
```

## Issue Tracker

If you find a bug or have a problem running the code, please file an issue on the [Issue Tracker](https://github.com/bouiz/compas_soundscape/issues).
