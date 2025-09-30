# backend/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import COMPAS geometry
from compas.geometry import Box, Frame
from compas.datastructures import Mesh

# 1. Initialize FastAPI app
app = FastAPI()

# 2. Configure CORS (Cross-Origin Resource Sharing)
# This is crucial to allow your Next.js app (e.g., on localhost:3000)
# to request data from your FastAPI app (e.g., on localhost:8000)
origins = [
    "http://localhost",
    "http://localhost:3000", # The default Next.js dev server port
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Define the API endpoint
@app.get("/api/geometry")
def get_geometry():
    """
    Creates a COMPAS geometry and returns its vertices and faces
    in a simple, web-friendly format.
    """
    # 1. Create the COMPAS geometry
    box = Box.from_width_height_depth(1.5, 1.5, 1.5)
    mesh = Mesh.from_shape(box)

    # 2. Extract vertices and faces into a simple list format
    #    This is the exact format our frontend expects.
    vertices = list(mesh.vertices_attributes('xyz'))
    faces = [mesh.face_vertices(fkey) for fkey in mesh.faces()]

    # 3. Return the data in a dictionary
    return {
        "vertices": vertices,
        "faces": faces
    }

# Optional: A simple root endpoint to check if the server is running
@app.get("/")
def read_root():
    return {"message": "COMPAS API is running"}