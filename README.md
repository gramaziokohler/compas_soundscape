compas_soundscape

Toy project to test template for Compas Soundscape.

Note: Replace <your-github-username> in the URLs below with your actual GitHub username.

Installation

Stable releases can be installed from PyPI.

code
Bash
download
content_copy
expand_less
pip install compas_soundscape

To install the latest version for development, clone the repository and install it in editable mode:

code
Bash
download
content_copy
expand_less
git clone https://github.com/<your-github-username>/compas_soundscape.git
cd compas_soundscape
pip install -e ".[dev]"
Documentation

For further "getting started" instructions, a tutorial, examples, and an API reference, please check out the online documentation.

Issue Tracker

If you find a bug or if you have a problem with running the code, please file an issue on the Issue Tracker.

Development Setup (Full-Stack Application)

This section guides you through setting up and running the full-stack application, which includes a Python backend and a JavaScript frontend.

Prerequisites

Before you begin, ensure you have the following installed on your system:

Python (version 3.9 or higher) and a package manager like pip.

Node.js (version 18 or higher) and its package manager npm.

Setup and Installation

Follow these steps to set up the dependencies for both the backend and the frontend.

1. Backend Setup

First, navigate to the backend directory and create a virtual environment to manage your Python dependencies.

code
Bash
download
content_copy
expand_less
# Navigate into the backend directory
cd backend

# Create a Python virtual environment
python -m venv .venv

# Activate the virtual environment
# On Windows:
# .venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

With the virtual environment active, install the required Python libraries:

code
Bash
download
content_copy
expand_less
# Install all necessary packages
pip install "fastapi[all]" compas uvicorn
2. Frontend Setup

Next, open a new terminal and navigate to the frontend directory to install the Node.js dependencies.

code
Bash
download
content_copy
expand_less
# Navigate into the frontend directory
cd frontend

# Install the node modules specified in package.json
npm install

# Install three.js and its types
npm install three
npm install --save-dev @types/three
Running the Application

To run the full-stack application, you must start both the backend and frontend servers simultaneously in two separate terminals.

Terminal 1: Start the Backend Server

Make sure you are in the backend directory with your Python virtual environment activated.

code
Bash
download
content_copy
expand_less
# (If not already there, navigate to the backend and activate the venv)
# cd backend
# source .venv/bin/activate

# Run the FastAPI server with live reloading
uvicorn main:app --reload

You should see a confirmation that the server is running. By default, it will be available at: http://127.0.0.1:8000.

You can test the API endpoint by visiting http://127.0.0.1:8000/api/geometry in your browser.

Terminal 2: Start the Frontend Server

In your second terminal, make sure you are in the frontend directory.

code
Bash
download
content_copy
expand_less
# (If not already there)
# cd frontend

# Run the Next.js development server
npm run dev

You should see a confirmation that the server is running. The frontend application will be available at: http://localhost:3000.

Viewing the Result

Open your web browser and navigate to http://localhost:3000.

The page will load, and a script in the ThreeScene component will make an API call to your running backend. The backend will generate a COMPAS box, send its vertex and face data back to the frontend, and Three.js will render it as a rotating wireframe cube in the background.