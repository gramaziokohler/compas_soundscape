"""
Test script for Hybrid ISM and Ray Tracing Simulator

This script demonstrates the new ray tracing functionality with mesh-based rooms.
"""

import numpy as np
from services.pyroomacoustics_service import PyroomacousticsService
from utils.acoustic_measurement import AcousticMeasurement


def test_ray_tracing_simple_box():
    """Test ray tracing with a simple box room"""

    print("=" * 60)
    print("Testing Hybrid ISM and Ray Tracing Simulator")
    print("=" * 60)

    # Create a simple box mesh (2m x 3m x 2.5m)
    # 8 vertices for a box
    vertices = [
        [0, 0, 0],     # 0: bottom-front-left
        [2, 0, 0],     # 1: bottom-front-right
        [2, 3, 0],     # 2: bottom-back-right
        [0, 3, 0],     # 3: bottom-back-left
        [0, 0, 2.5],   # 4: top-front-left
        [2, 0, 2.5],   # 5: top-front-right
        [2, 3, 2.5],   # 6: top-back-right
        [0, 3, 2.5],   # 7: top-back-left
    ]

    # Define 6 faces (walls) for the box
    faces = [
        [0, 1, 2, 3],  # Floor
        [4, 5, 6, 7],  # Ceiling
        [0, 1, 5, 4],  # Front wall
        [2, 3, 7, 6],  # Back wall
        [0, 3, 7, 4],  # Left wall
        [1, 2, 6, 5],  # Right wall
    ]

    # Define materials (absorption coefficients) for each face
    face_materials = {
        0: 0.05,  # Floor - concrete (low absorption)
        1: 0.70,  # Ceiling - acoustic tile (high absorption)
        2: 0.10,  # Front wall - plaster
        3: 0.10,  # Back wall - plaster
        4: 0.15,  # Left wall - wood panel
        5: 0.18,  # Right wall - glass window
    }

    # Define scattering coefficients for ray tracing
    face_scattering = {
        0: 0.05,  # Floor - smooth concrete (low scattering)
        1: 0.60,  # Ceiling - acoustic tile (high scattering)
        2: 0.10,  # Front wall - smooth plaster
        3: 0.10,  # Back wall - smooth plaster
        4: 0.20,  # Left wall - wood panel (moderate scattering)
        5: 0.05,  # Right wall - glass (very low scattering)
    }

    print("\n1. Creating room WITHOUT ray tracing (ISM only)...")
    room_ism = PyroomacousticsService.create_room_from_mesh(
        vertices=vertices,
        faces=faces,
        face_materials=face_materials,
        max_order=15,
        ray_tracing=False
    )
    print(f"   Room created with ISM only (max_order=15)")

    print("\n2. Creating room WITH ray tracing (Hybrid ISM + Ray Tracing)...")
    room_hybrid = PyroomacousticsService.create_room_from_mesh(
        vertices=vertices,
        faces=faces,
        face_materials=face_materials,
        face_scattering=face_scattering,
        max_order=3,  # Recommended max_order for hybrid simulator
        ray_tracing=True,
        air_absorption=True
    )
    print(f"   Room created with ray_tracing=True (max_order=3)")

    # Source and receiver positions
    source_position = [1.0, 1.0, 1.2]
    receiver_position = [1.0, 2.0, 1.6]

    print(f"\n3. Simulating acoustics...")
    print(f"   Source: {source_position}")
    print(f"   Receiver: {receiver_position}")

    # Simulate with ISM only
    print("\n   a) ISM only simulation...")
    room_ism = PyroomacousticsService.simulate_room_acoustics(
        room=room_ism,
        source_position=source_position,
        receiver_position=receiver_position,
        enable_ray_tracing=False  # Explicitly disable automatic ray tracing
    )

    # Simulate with Hybrid ISM + Ray Tracing
    print("\n   b) Hybrid ISM + Ray Tracing simulation...")
    room_hybrid = PyroomacousticsService.simulate_room_acoustics(
        room=room_hybrid,
        source_position=source_position,
        receiver_position=receiver_position,
        enable_ray_tracing=True  # This will automatically call enable_ray_tracing()
    )

    print("\n4. Calculating acoustic parameters...")

    # Calculate acoustic parameters for ISM only
    params_ism = AcousticMeasurement.calculate_acoustic_parameters(room_ism)
    print("\n   ISM Only Results:")
    print(f"   - RT60: {params_ism['rt60']:.3f}s")
    print(f"   - EDT: {params_ism['edt']:.3f}s")
    print(f"   - C50: {params_ism['c50']:.2f} dB")
    print(f"   - C80: {params_ism['c80']:.2f} dB")
    print(f"   - D50: {params_ism['d50']:.3f}")
    print(f"   - DRR: {params_ism['drr']:.2f} dB")

    # Calculate acoustic parameters for Hybrid
    params_hybrid = AcousticMeasurement.calculate_acoustic_parameters(room_hybrid)
    print("\n   Hybrid ISM + Ray Tracing Results:")
    print(f"   - RT60: {params_hybrid['rt60']:.3f}s")
    print(f"   - EDT: {params_hybrid['edt']:.3f}s")
    print(f"   - C50: {params_hybrid['c50']:.2f} dB")
    print(f"   - C80: {params_hybrid['c80']:.2f} dB")
    print(f"   - D50: {params_hybrid['d50']:.3f}")
    print(f"   - DRR: {params_hybrid['drr']:.2f} dB")

    # Show differences
    print("\n5. Comparison (Hybrid - ISM):")
    print(f"   - RT60 difference: {params_hybrid['rt60'] - params_ism['rt60']:.3f}s")
    print(f"   - C50 difference: {params_hybrid['c50'] - params_ism['c50']:.2f} dB")

    print("\n" + "=" * 60)
    print("Test completed successfully!")
    print("=" * 60)
    print("\nNote: Ray tracing provides more accurate late reverberation,")
    print("especially for complex geometries and longer RT60 values.")


if __name__ == "__main__":
    test_ray_tracing_simple_box()
