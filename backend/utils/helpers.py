# backend/utils/helpers.py
# Helper Functions

def rotate_y_up_to_z_up(vertex):
    """
    Rotate a vertex from Y-up to Z-up coordinate system.
    Rotation: -90 degrees around X axis
    Transform: (x, y, z) -> (x, z, -y)
    """
    return [vertex[0], vertex[2], -vertex[1]]
