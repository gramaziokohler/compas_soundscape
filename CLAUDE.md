# Claude Code: Modular Development Guidelines

-----

## 🚀 Project Context

  * **Architecture:** FastAPI (Backend) + Next.js 15 (Frontend) + Three.js (3D Visualization)
  * **Backend Environment:** Mamba environment `compas-toy`
  * **Key Technologies:** COMPAS, Google Gemini, TangoFlux, rhino3dm, React 19, WaveForm

-----

## 📚 Documentation & Workflow

This is the central guide for making changes. **Follow this process for all updates.**

### 1\. Workflow Decision Tree

Use this tree to guide your actions.

  * **New feature/endpoint?**
      * Update `architecture.md` with the new data flow.
      * Create a new router + service (backend) or hook (frontend).
  * **Magic number or config value?**
      * Move it to `backend/config/constants.py` or `frontend/src/lib/constants.ts`.
  * **Code repeated (2+ times or \>10 lines)?**
      * Extract it to a new utility module.
  * **UI pattern repeated (3+ times)?**
      * Extract it to a reusable component in `frontend/src/components/ui/`.
      * Examples: buttons, sliders, checkboxes, icons, validation messages.
  * **File exceeds 400 lines?**
      * Split the file by responsibility (see SRP).
  * **Need a new API call?**
      * Add a new method to `frontend/src/services/api.ts`.
      * **NEVER** use `fetch` directly in a component.


## 🏛️ Core Principles

### 1\. File Creation (Modular Architecture)

**Create new files when:**

  * Adding reusable utilities (\>10 lines or used 2+ times).
  * Implementing features with multiple functions.
  * Adding processing logic (audio, video, image).
  * Building external API services.
  * Implementing complex algorithms.
  * **Any file exceeds 400 lines.**

**Note:** When you create files, update `architecture.md` as described in the Documentation section.

### 2\. File Organization

**Key locations to remember:**

  * **Backend Constants:** `backend/config/constants.py`
  * **Frontend Constants:** `frontend/src/lib/constants.ts`
  * **Backend Services:** `backend/services/[name]_service.py`
  * **Frontend Hooks:** `frontend/src/hooks/use[Name].ts`
  * **Frontend UI Components:** `frontend/src/components/ui/[ComponentName].tsx`
  * **API Schemas:** `backend/models/schemas.py`
  * **Type Definitions:** `frontend/src/types/[domain].ts`
  * **API Client:** `frontend/src/services/api.ts`
  * **Three.js Services:** `frontend/src/lib/three/[name]-[type].ts`

### 3\. Constants Management

**All configuration values must be defined as constants** in `backend/config/constants.py` or `frontend/src/lib/constants.ts`. This includes:

  * API keys, timeouts, retries
  * File size limits, allowed extensions
  * Audio/model parameters (TangoFlux, Gemini)
  * Paths and directories
  * 3D scene parameters (camera, colors, sizes)
  * **UI colors, spacing, borders, opacity values** (frontend)
  * **SVG attributes (xmlns, stroke properties)** (frontend)
  * **Tailwind class patterns for programmatic use** (frontend)

**Usage pattern:**

```python
# ❌ BAD - magic numbers
audio = generate(prompt, duration=10, guidance=3.5)

# ✅ GOOD - use constants
from config.constants import DEFAULT_AUDIO_DURATION, DEFAULT_GUIDANCE_SCALE
audio = generate(prompt, duration=DEFAULT_AUDIO_DURATION, guidance=DEFAULT_GUIDANCE_SCALE)
```

```tsx
// ❌ BAD - hardcoded colors and SVG attributes
<button style={{ color: '#F500B8', borderBottom: '2px solid #0ea5e9' }}>
<svg xmlns="http://www.w3.org/2000/svg" strokeWidth="1.5" stroke="currentColor">

// ✅ GOOD - use constants
import { UI_COLORS, SVG_ICON_PROPS } from '@/lib/constants';
<button style={{ color: UI_COLORS.PRIMARY, borderBottom: `2px solid ${UI_COLORS.PRIMARY}` }}>
<svg {...SVG_ICON_PROPS}>
```

-----

## 📋 Code Quality Rules

  * **DRY (Don't Repeat Yourself)**

      * Extract repeated code (\>10 lines) to utilities.
      * Extract repeated UI patterns (3+ times) to reusable components.
      * Use composition over duplication.
      * **Examples:** `utils/audio_processing.py`, `services/geometry_service.py`, `components/ui/RangeSlider.tsx`
      * **UI Components:** When you find the same JSX structure repeated (buttons, inputs, sliders), create a reusable component with proper TypeScript interfaces.

  * **SRP (Single Responsibility)**

      * One clear purpose per file/function.
      * Split files at 400 lines.
      * Separate data fetching, business logic, and UI.
      * **Examples:** `routers/upload.py` (only handles uploads), `hooks/useFileUpload.ts` (only manages upload state).

  * **Type Safety**

      * **Backend:** Use Pydantic models in `backend/models/schemas.py`.
      * **Frontend:** Define TypeScript interfaces in `frontend/src/types/`.

  * **Error Handling**

      * **Backend:** Use `HTTPException` with proper status codes.
      * **Frontend:** Use `try-catch` blocks with user-friendly error messages.

  * **Environment-Specific Code**

      * **Never commit `.env` files with API keys.**
      * Backend: Use `python-dotenv` to load variables.
      * Frontend: Use `NEXT_PUBLIC_` prefix for client-side variables.
      * **Required env vars:** `GOOGLE_API_KEY`, `FREESOUND_API_KEY`, `BBC_API_KEY`

  * **Dependency Injection (Backend)**

      * Initialize services in `main.py` and inject into routers via `init_*_router()` functions.
      * This ensures easy testing and loose coupling.

-----

## 🎨 Styling Consistency

1.  Check `frontend/src/app/globals.css` for existing CSS variables.
2.  Check `frontend/src/lib/constants.ts` for programmatic color/size values.
3.  Use Tailwind utility classes consistently.
4.  For custom theme values, use Tailwind 4's `@theme` directive in `globals.css`.

-----

## 🧩 Project-Specific Patterns

**Use existing files as your reference:**

  * **Backend Router:** `backend/routers/upload.py` or `sounds.py`
  * **Backend Service:** `backend/services/audio_service.py`
  * **Frontend Hook:** `frontend/src/hooks/useFileUpload.ts`
  * **API Service:** `frontend/src/services/api.ts`

### Critical Implementation Rules

#### Backend

1.  **Routers:** Use the dependency injection pattern from `main.py`.
2.  **Services:** Use classes with proper type hints and docstrings.
3.  **Schemas:** Define all request/response models in `models/schemas.py`.
4.  **Errors:** Use FastAPI's `HTTPException`.

#### Frontend

1.  **Hooks:** Return typed objects: `{ state, methods }`.
2.  **API calls:** All calls must go through `apiService` in `services/api.ts`.
3.  **Components:** Use `'use client'` and TypeScript interfaces for props.
4.  **State:** Use React hooks (e.g., `useState`, `useCallback`).
5.  **UI Reusability:**
      * **Never hardcode colors** - always use `UI_COLORS` from `constants.ts`.
      * Extract repeated UI patterns (3+ instances) to `components/ui/`.
      * Use inline styles with constants for dynamic/programmatic styling.
      * Reusable components should have clear TypeScript interfaces and JSDoc comments.
      * Examples: `TabButton`, `RangeSlider`, `CheckboxField`, `ButtonGroup`, `SceneControlButton`, `Icon`.

-----

## ⚙️ Environment & Running the Project

### Mamba Environment Commands

```powershell
# ALWAYS activate before backend work
mamba activate compas-toy

# Install new packages
pip install package_name

# Update after installing
pip freeze > requirements.txt  
```

### Running the Project

```powershell
# Backend (from backend/ directory)
mamba activate compas-toy
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend (from frontend/ directory)
npm install  # First time only
npm run dev  # Development with Turbopack
```