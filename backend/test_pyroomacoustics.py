"""
Test script for pyroomacoustics integration
Demonstrates both API testing and direct library usage with visualization
"""
import requests
import json
import numpy as np
import matplotlib.pyplot as plt
import pyroomacoustics as pra
from scipy.io import wavfile

# API Base URL
API_BASE = "http://localhost:8000"

def print_section(title):
    """Print a formatted section header"""
    print("\n" + "="*80)
    print(f"  {title}")
    print("="*80)

def test_materials_endpoint():
    """Test GET /pyroomacoustics/materials endpoint"""
    print_section("TEST 1: Materials Database Endpoint")

    response = requests.get(f"{API_BASE}/pyroomacoustics/materials")

    if response.status_code == 200:
        data = response.json()
        materials = data['materials']

        print(f"✓ Status: {response.status_code} OK")
        print(f"✓ Found {len(materials)} materials\n")

        # Display materials in a formatted table
        print(f"{'Material Name':<20} {'Absorption':<12} {'Category':<12} {'Description'}")
        print("-" * 80)
        for name, props in materials.items():
            print(f"{name:<20} {props['absorption']:<12.2f} {props['category']:<12} {props['description']}")

        return materials
    else:
        print(f"✗ Error: {response.status_code}")
        print(response.text)
        return None

def test_simulation_endpoint(scenario_name, request_data):
    """Test POST /pyroomacoustics/simulate endpoint"""
    print_section(f"TEST 2: Simulation Endpoint - {scenario_name}")

    print("Request:")
    print(json.dumps(request_data, indent=2))

    response = requests.post(
        f"{API_BASE}/pyroomacoustics/simulate",
        json=request_data,
        headers={"Content-Type": "application/json"}
    )

    if response.status_code == 200:
        data = response.json()

        print(f"\n✓ Status: {response.status_code} OK")
        print(f"✓ Computation time: {data['computation_time']:.3f}s")
        print(f"✓ RIR saved to: {data['rir_path']}")
        print(f"✓ RIR URL: {data['rir_url']}")

        # Display room info
        print("\nRoom Information:")
        room_info = data['room_info']
        dims = room_info['dimensions']
        print(f"  Dimensions: {dims['width']}m × {dims['length']}m × {dims['height']}m")
        print(f"  Volume: {room_info['volume']:.1f} m³")
        print(f"  Sample rate: {room_info['fs']} Hz")
        print(f"  Max order: {room_info['max_order']}")

        # Display acoustic parameters
        print("\nAcoustic Parameters:")
        params = data['acoustic_parameters']
        print(f"  RT60 (Reverberation Time): {params['rt60']:.3f} s")
        print(f"  EDT (Early Decay Time):    {params['edt']:.3f} s")
        print(f"  C50 (Speech Clarity):      {params['c50']:.2f} dB")
        print(f"  C80 (Music Clarity):       {params['c80']:.2f} dB")
        print(f"  D50 (Definition):          {params['d50']:.3f}")
        print(f"  DRR (Direct-to-Reverb):    {params['drr']:.2f} dB")

        # Interpret the results
        print("\nInterpretation:")
        if params['rt60'] < 0.5:
            print("  • Very short reverberation (dead/anechoic space)")
        elif params['rt60'] < 1.0:
            print("  • Short reverberation (good for speech)")
        elif params['rt60'] < 2.0:
            print("  • Moderate reverberation (good for music)")
        else:
            print("  • Long reverberation (cathedral-like)")

        if params['c50'] > 0:
            print(f"  • Good speech clarity (C50 > 0 dB)")
        else:
            print(f"  • Poor speech clarity (C50 < 0 dB)")

        return data
    else:
        print(f"\n✗ Error: {response.status_code}")
        print(response.text)
        return None

def visualize_room_setup(room_dimensions, source_pos, receiver_pos, scenario_name):
    """Visualize the room setup in 3D"""
    print_section(f"Visualization: {scenario_name}")

    fig = plt.figure(figsize=(12, 5))

    # 3D view
    ax1 = fig.add_subplot(121, projection='3d')

    # Draw room boundaries
    w, l, h = room_dimensions
    vertices = np.array([
        [0, 0, 0], [w, 0, 0], [w, l, 0], [0, l, 0],  # Floor
        [0, 0, h], [w, 0, h], [w, l, h], [0, l, h]   # Ceiling
    ])

    # Draw edges
    edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],  # Floor
        [4, 5], [5, 6], [6, 7], [7, 4],  # Ceiling
        [0, 4], [1, 5], [2, 6], [3, 7]   # Vertical edges
    ]

    for edge in edges:
        points = vertices[edge]
        ax1.plot3D(*points.T, 'b-', alpha=0.3, linewidth=1)

    # Plot source and receiver
    ax1.scatter(*source_pos, color='red', s=200, marker='*', label='Source', edgecolors='black', linewidths=2)
    ax1.scatter(*receiver_pos, color='green', s=200, marker='o', label='Receiver', edgecolors='black', linewidths=2)

    ax1.set_xlabel('X (m)')
    ax1.set_ylabel('Y (m)')
    ax1.set_zlabel('Z (m)')
    ax1.set_title(f'Room Setup - {scenario_name}')
    ax1.legend()
    ax1.set_box_aspect([w, l, h])

    # Top view
    ax2 = fig.add_subplot(122)

    # Draw room outline
    room_outline = np.array([[0, 0], [w, 0], [w, l], [0, l], [0, 0]])
    ax2.plot(room_outline[:, 0], room_outline[:, 1], 'b-', linewidth=2, label='Room')

    # Plot source and receiver (top view)
    ax2.scatter(source_pos[0], source_pos[1], color='red', s=300, marker='*',
                label='Source', edgecolors='black', linewidths=2, zorder=5)
    ax2.scatter(receiver_pos[0], receiver_pos[1], color='green', s=300, marker='o',
                label='Receiver', edgecolors='black', linewidths=2, zorder=5)

    # Draw line between source and receiver
    ax2.plot([source_pos[0], receiver_pos[0]], [source_pos[1], receiver_pos[1]],
             'k--', alpha=0.3, linewidth=1)

    # Calculate distance
    distance = np.sqrt((source_pos[0] - receiver_pos[0])**2 +
                       (source_pos[1] - receiver_pos[1])**2 +
                       (source_pos[2] - receiver_pos[2])**2)

    ax2.text((source_pos[0] + receiver_pos[0])/2, (source_pos[1] + receiver_pos[1])/2,
             f'{distance:.2f}m', fontsize=10, ha='center')

    ax2.set_xlabel('X (m)')
    ax2.set_ylabel('Y (m)')
    ax2.set_title(f'Top View - {w}m × {l}m')
    ax2.set_aspect('equal')
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(f'backend/temp/room_setup_{scenario_name.replace(" ", "_")}.png', dpi=150)
    print(f"✓ Room setup saved to: backend/temp/room_setup_{scenario_name.replace(' ', '_')}.png")

    return fig

def visualize_rir(rir_path, scenario_name):
    """Visualize the room impulse response"""
    try:
        # Read the RIR WAV file
        fs, rir = wavfile.read(rir_path)

        # Convert to float and normalize
        rir = rir.astype(float) / 32767.0

        # Time axis
        time = np.arange(len(rir)) / fs

        # Create figure
        fig, axes = plt.subplots(2, 1, figsize=(12, 8))

        # Plot waveform
        axes[0].plot(time * 1000, rir, linewidth=0.5)
        axes[0].set_xlabel('Time (ms)')
        axes[0].set_ylabel('Amplitude')
        axes[0].set_title(f'Room Impulse Response - {scenario_name}')
        axes[0].grid(True, alpha=0.3)

        # Plot energy decay (Schroeder integration)
        energy = rir ** 2
        schroeder = np.cumsum(energy[::-1])[::-1]
        schroeder_db = 10 * np.log10(schroeder / schroeder[0] + 1e-10)

        axes[1].plot(time * 1000, schroeder_db, linewidth=1)
        axes[1].set_xlabel('Time (ms)')
        axes[1].set_ylabel('Energy (dB)')
        axes[1].set_title('Energy Decay Curve (Schroeder Integration)')
        axes[1].grid(True, alpha=0.3)
        axes[1].axhline(y=-60, color='r', linestyle='--', linewidth=1, label='RT60 Reference')
        axes[1].legend()

        plt.tight_layout()
        plt.savefig(f'backend/temp/rir_{scenario_name.replace(" ", "_")}.png', dpi=150)
        print(f"✓ RIR visualization saved to: backend/temp/rir_{scenario_name.replace(' ', '_')}.png")

        return fig

    except Exception as e:
        print(f"✗ Error visualizing RIR: {e}")
        return None

def direct_pyroomacoustics_demo():
    """Demonstrate direct usage of pyroomacoustics library with visualization"""
    print_section("TEST 3: Direct Pyroomacoustics Demo (with Beamforming)")

    # Create a 4 by 6 metres shoe box room
    room = pra.ShoeBox([4, 6], fs=16000, max_order=3, materials=pra.Material(0.2))

    # Add a source somewhere in the room
    room.add_source([2.5, 4.5])

    # Create a linear array beamformer with 4 microphones
    # with angle 0 degrees and inter mic distance 10 cm
    R = pra.linear_2D_array([2, 1.5], 4, 0, 0.1)
    room.add_microphone_array(pra.Beamformer(R, room.fs))

    # Compute the delay and sum weights for the beamformer
    room.mic_array.rake_delay_and_sum_weights(room.sources[0][:1])

    print("✓ Created 4×6m room with beamformer array")
    print("✓ 4 microphones in linear array (10cm spacing)")
    print("✓ Source at [2.5, 4.5]m")

    # Plot the room and resulting beamformer
    fig, axes = room.plot(freq=[1000, 2000, 4000, 8000], img_order=0)
    plt.savefig('backend/temp/pyroomacoustics_beamformer_demo.png', dpi=150)
    print("✓ Beamformer visualization saved to: backend/temp/pyroomacoustics_beamformer_demo.png")

    return fig

def run_all_tests():
    """Run all tests"""
    print("\n" + "█"*80)
    print("  PYROOMACOUSTICS INTEGRATION TEST SUITE")
    print("█"*80)

    # Test 1: Materials endpoint
    materials = test_materials_endpoint()

    if materials:
        # Test 2a: Classroom simulation (moderate absorption)
        classroom_request = {
            "room_dimensions": [8, 10, 3],
            "materials": {
                "north": 0.03,
                "south": 0.03,
                "east": 0.03,
                "west": 0.03,
                "floor": 0.10,
                "ceiling": 0.70
            },
            "source_position": [2, 2, 1.5],
            "receiver_position": [6, 6, 1.6],
            "settings": {
                "fs": 48000,
                "max_order": 3
            }
        }

        classroom_result = test_simulation_endpoint("Classroom", classroom_request)

        if classroom_result:
            visualize_room_setup(
                classroom_request['room_dimensions'],
                classroom_request['source_position'],
                classroom_request['receiver_position'],
                "Classroom"
            )
            visualize_rir(classroom_result['rir_path'], "Classroom")

        # Test 2b: Anechoic chamber (high absorption)
        anechoic_request = {
            "room_dimensions": [5, 5, 3],
            "materials": {
                "north": 0.95,
                "south": 0.95,
                "east": 0.95,
                "west": 0.95,
                "floor": 0.95,
                "ceiling": 0.95
            },
            "source_position": [2.5, 2.5, 1.5],
            "receiver_position": [3.5, 2.5, 1.5],
            "settings": {
                "fs": 48000,
                "max_order": 3
            }
        }

        anechoic_result = test_simulation_endpoint("Anechoic Chamber", anechoic_request)

        if anechoic_result:
            visualize_room_setup(
                anechoic_request['room_dimensions'],
                anechoic_request['source_position'],
                anechoic_request['receiver_position'],
                "Anechoic_Chamber"
            )
            visualize_rir(anechoic_result['rir_path'], "Anechoic_Chamber")

        # Test 2c: Reverberant hall (low absorption)
        hall_request = {
            "room_dimensions": [20, 30, 8],
            "materials": {
                "north": 0.02,
                "south": 0.02,
                "east": 0.02,
                "west": 0.02,
                "floor": 0.05,
                "ceiling": 0.05
            },
            "source_position": [10, 5, 1.5],
            "receiver_position": [10, 25, 1.5],
            "settings": {
                "fs": 48000,
                "max_order": 10
            }
        }

        hall_result = test_simulation_endpoint("Concert Hall", hall_request)

        if hall_result:
            visualize_room_setup(
                hall_request['room_dimensions'],
                hall_request['source_position'],
                hall_request['receiver_position'],
                "Concert_Hall"
            )
            visualize_rir(hall_result['rir_path'], "Concert_Hall")

    # Test 3: Direct pyroomacoustics demo
    direct_pyroomacoustics_demo()

    print_section("All Tests Complete!")
    print("\n✓ All visualizations saved to backend/temp/")
    print("✓ You can view the PNG files to see the results")

    # Show all plots
    plt.show()

if __name__ == "__main__":
    # Make sure temp directory exists
    import os
    os.makedirs('backend/temp', exist_ok=True)

    run_all_tests()
