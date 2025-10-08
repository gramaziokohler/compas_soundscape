# compas_soundscape

Toy project to test template for Compas Soundscape

## Installation

Stable releases can be installed from PyPI.

```bash
pip install compas_soundscape
```

To install the latest version for development, do:

```bash
git clone https://github.com/bouiz/compas_soundscape.git
cd compas_soundscape
pip install -e ".[dev]"
```

## Documentation

For further "getting started" instructions, a tutorial, examples, and an API reference,
please check out the online documentation here: [compas_soundscape docs](https://.github.io/bouiz/compas_soundscape)

## Issue Tracker

If you find a bug or if you have a problem with running the code, please file an issue on the [Issue Tracker](https://github.com/bouiz/compas_soundscape/issues).

## Prerequisites

- Python 3.9+ (recommend using Mamba/Conda)
- Node.js 18+ and pnpm
- Google Gemini API key

## Installation

### 1. Backend Setup

```bash
# Create and activate conda/mamba environment
mamba create -n compas-toy -c conda-forge compas
mamba activate compas-toy

# Install Python dependencies
cd backend
pip install -r ../requirements.txt
```

### 2. Frontend Setup

```bash
# Install Node.js dependencies
cd frontend
pnpm install
```

### 3. Environment Configuration

Create a `.env` file in the `backend` directory:

```bash
GOOGLE_API_KEY=your_gemini_api_key_here
```

## Running the Application

Start both servers in separate terminals:

**Terminal 1 - Backend:**
```bash
cd backend
mamba activate compas-toy
uvicorn main:app --reload
```

Backend runs at: `http://127.0.0.1:8000`

**Terminal 2 - Frontend:**
```bash
cd frontend
pnpm dev
```

Frontend runs at: `http://localhost:3000`

## Features

- Upload and visualize 3D models (.obj, .stl, .ifc, .3dm)
- AI-powered sound prompt generation using Google Gemini
- Generate spatial audio using TangoFlux
- Interactive 3D visualization with Three.js
- Real-time audio playback with positional sound