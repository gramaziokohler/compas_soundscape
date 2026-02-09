# COMPAS Soundscape

A full-stack web application for 3D architectural acoustic simulation and spatial audio rendering. Load 3D models via Speckle, assign acoustic materials, simulate room acoustics, and generate immersive soundscapes with AI-powered audio.

## Prerequisites

- **Python 3.10+** (recommend using [Mamba](https://mamba.readthedocs.io/) or Conda)
- **CUDA 12.1+** (for GPU-accelerated audio generation with PyTorch)
- **Node.js 18+** and **npm** (or pnpm)
- **Git**

### Required API Keys

| Key | Purpose | Get it from |
|-----|---------|-------------|
| `GOOGLE_API_KEY` | Google Gemini LLM (text/prompt generation) | [Google AI Studio](https://aistudio.google.com/apikey) |
| `SPECKLE_TOKEN` | Speckle 3D model platform access | [Speckle Account](https://app.speckle.systems/) |

### Optional API Keys

| Key | Purpose | Get it from |
|-----|---------|-------------|
| `FREESOUND_API_KEY` | Freesound library search | [Freesound API](https://freesound.org/apiv2/apply/) |
| `BBC_API_KEY` | BBC Sound Effects library | BBC Developer Portal |

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/bouiz/compas_soundscape.git
cd compas_soundscape
```

### 2. Backend Setup

```bash
# Create and activate the Mamba/Conda environment
mamba create -n compas-toy python=3.10 -c conda-forge
mamba activate compas-toy

# Install PyTorch with CUDA 12.1 support
pip install torch==2.4.0+cu121 torchaudio==2.4.0+cu121 --extra-index-url https://download.pytorch.org/whl/cu121

# Install remaining Python dependencies
pip install -r requirements.txt
```

### 3. Frontend Setup

```bash
cd frontend
npm install
```

### 4. Environment Configuration

**Backend** - Create a `.env` file in the `backend/` directory:

```env
GOOGLE_API_KEY=your_google_api_key_here
SPECKLE_TOKEN=your_speckle_token_here
```

**Frontend** - The API URL is auto-detected by default. To override, create a `.env.local` file in the `frontend/` directory:

```env
# Optional: override API base URL (auto-detected by default)
# NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Running the Application

Start both servers in separate terminals:

**Terminal 1 - Backend:**

```bash
mamba activate compas-toy
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend API runs at: `http://localhost:8000`
API docs available at: `http://localhost:8000/docs`

**Terminal 2 - Frontend:**

```bash
cd frontend
npm run dev
```

Frontend runs at: `http://localhost:3000`

## Features

### 3D Model Integration (Speckle)
- Load and visualize 3D architectural models from Speckle
- Browse object tree hierarchy with filtering
- Interactive selection and material assignment

### Acoustic Simulation
- **Pyroomacoustics**: Image Source Method (ISM) for room impulse response generation, RT60, EDT, C80
- **Choras**: Diffusion equation-based acoustic simulation
- **Resonance Audio**: Google Resonance Audio real-time spatial rendering
- Surface material assignment with absorption coefficients

### Audio Generation & Rendering
- AI-powered sound prompt generation using Google Gemini
- Text-to-audio generation using TangoFlux / AudioLDM2
- Sound library search (Freesound, BBC Sound Effects)
- Ambisonic IR convolution (FOA/TOA) with binaural decoding
- Multiple rendering modes: Anechoic, Resonance Audio, Ambisonic IR
- Real-time spatial audio playback with head tracking

### Visualization & Interaction
- 3D scene with receiver and sound source placement
- Draggable sound spheres and receiver cubes
- Waveform visualization (WaveSurfer.js)
- Timeline-based playback with scheduling

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4 |
| 3D Viewer | Speckle Viewer (Three.js-based) |
| Spatial Audio | Resonance Audio, Omnitone, Ambisonics.js |
| Audio Viz | WaveSurfer.js |
| Backend | FastAPI, Python 3.10+ |
| Audio Gen | TangoFlux, AudioLDM2, PyTorch (CUDA) |
| Room Acoustics | Pyroomacoustics, SfePy (FEM) |
| LLM | Google Gemini |
| 3D Platform | Speckle (specklepy) |

## Project Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full project structure and architecture diagrams.

```
compas_soundscape/
├── backend/            # FastAPI server (routers, services, utils)
├── frontend/           # Next.js app (components, hooks, lib, contexts)
├── ARCHITECTURE.md     # Detailed architecture & file tree
└── requirements.txt    # Python dependencies
```

## Issue Tracker

If you find a bug or have a problem running the code, please file an issue on the [Issue Tracker](https://github.com/bouiz/compas_soundscape/issues).
