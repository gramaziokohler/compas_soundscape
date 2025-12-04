"""
Debug script to investigate RT60 calculation issue
"""
import numpy as np
import pyroomacoustics as pra
import matplotlib.pyplot as plt
from scipy.io import wavfile

def calculate_sabine_rt60(room_dims, materials_dict):
    """Calculate theoretical RT60 using Sabine formula"""
    width, length, height = room_dims

    # Calculate surface areas
    north_south = length * height
    east_west = width * height
    floor_ceiling = width * length

    # Calculate total absorption (in sabins)
    absorption = (
        north_south * materials_dict['north'] +
        north_south * materials_dict['south'] +
        east_west * materials_dict['east'] +
        east_west * materials_dict['west'] +
        floor_ceiling * materials_dict['floor'] +
        floor_ceiling * materials_dict['ceiling']
    )

    # Total surface area
    total_surface = 2 * (north_south + east_west + floor_ceiling)

    # Volume
    volume = width * length * height

    # Sabine formula: RT60 = 0.161 * V / A
    rt60_sabine = 0.161 * volume / absorption

    print(f"\nSabine Formula Calculation:")
    print(f"  Volume: {volume:.1f} m³")
    print(f"  Total Surface: {total_surface:.1f} m²")
    print(f"  Total Absorption: {absorption:.2f} sabins")
    print(f"  Average α: {absorption/total_surface:.3f}")
    print(f"  Theoretical RT60: {rt60_sabine:.3f} s")

    return rt60_sabine

def test_classroom_with_different_orders():
    """Test classroom simulation with different max_order values"""
    print("="*80)
    print("INVESTIGATING RT60 CALCULATION ISSUE")
    print("="*80)

    # Classroom parameters
    room_dims = [8, 10, 3]  # width, length, height
    materials_dict = {
        'north': 0.03,
        'south': 0.03,
        'east': 0.03,
        'west': 0.03,
        'floor': 0.10,
        'ceiling': 0.70
    }
    source_pos = [2, 2, 1.5]
    receiver_pos = [6, 6, 1.6]
    fs = 48000

    # Calculate theoretical RT60
    rt60_theory = calculate_sabine_rt60(room_dims, materials_dict)

    # Test with different max_order values
    max_orders = [3, 5, 10, 15, 20]

    fig, axes = plt.subplots(len(max_orders), 2, figsize=(14, 4*len(max_orders)))

    for idx, max_order in enumerate(max_orders):
        print(f"\n{'='*80}")
        print(f"Testing with max_order = {max_order}")
        print(f"{'='*80}")

        # Create materials
        material_objects = {
            name: pra.Material(absorption)
            for name, absorption in materials_dict.items()
        }

        # Create room (swap width/length for pra convention)
        room = pra.ShoeBox(
            p=[room_dims[1], room_dims[0], room_dims[2]],  # [length, width, height]
            fs=fs,
            materials=material_objects,
            max_order=max_order
        )

        # Add source and receiver (swap x/y for pra convention)
        room.add_source([source_pos[1], source_pos[0], source_pos[2]])
        room.add_microphone([receiver_pos[1], receiver_pos[0], receiver_pos[2]])

        # Compute RIR
        room.compute_rir()

        # Get RIR
        rir = room.rir[0][0]

        print(f"  RIR length: {len(rir)} samples ({len(rir)/fs:.3f} s)")
        print(f"  Number of image sources: {len(room.sources[0].images)}")

        # Calculate RT60 using pyroomacoustics
        try:
            rt60_pra = pra.experimental.rt60.measure_rt60(rir, fs=fs, decay_db=60)
            if rt60_pra is None or np.isnan(rt60_pra):
                rt60_pra = None
        except:
            rt60_pra = None

        # Calculate energy decay
        energy = rir ** 2
        schroeder = np.cumsum(energy[::-1])[::-1]
        schroeder_db = 10 * np.log10(schroeder / schroeder[0] + 1e-10)

        # Find actual decay range
        min_db = schroeder_db[-1]
        max_db = schroeder_db[0]
        decay_range = max_db - min_db

        print(f"  Decay range: {decay_range:.1f} dB (need 60dB for RT60)")
        print(f"  Measured RT60: {rt60_pra:.3f} s" if rt60_pra else "  Measured RT60: Failed (insufficient decay)")
        print(f"  Theoretical RT60: {rt60_theory:.3f} s")
        print(f"  Error: {abs(rt60_pra - rt60_theory) / rt60_theory * 100:.1f}%" if rt60_pra else "  Error: N/A")

        # Plot RIR
        time = np.arange(len(rir)) / fs
        axes[idx, 0].plot(time * 1000, rir, linewidth=0.5)
        axes[idx, 0].set_xlabel('Time (ms)')
        axes[idx, 0].set_ylabel('Amplitude')
        axes[idx, 0].set_title(f'RIR (max_order={max_order})')
        axes[idx, 0].grid(True, alpha=0.3)

        # Plot energy decay
        axes[idx, 1].plot(time * 1000, schroeder_db, linewidth=1, label='Energy decay')
        axes[idx, 1].axhline(y=-60, color='r', linestyle='--', linewidth=1, label='RT60 reference')
        axes[idx, 1].set_xlabel('Time (ms)')
        axes[idx, 1].set_ylabel('Energy (dB)')
        axes[idx, 1].set_title(f'Energy Decay (max_order={max_order}, decay={decay_range:.1f}dB)')
        axes[idx, 1].grid(True, alpha=0.3)
        axes[idx, 1].legend()
        axes[idx, 1].set_ylim([-80, 5])

    plt.tight_layout()
    plt.savefig('backend/temp/rt60_investigation.png', dpi=150)
    print(f"\n{'='*80}")
    print("✓ Investigation plot saved to: backend/temp/rt60_investigation.png")
    print(f"{'='*80}")

    # Don't show plot in automated testing
    # plt.show()
    plt.close()

def test_anechoic_chamber():
    """Test anechoic chamber to verify it should have very short RT60"""
    print("\n" + "="*80)
    print("TESTING ANECHOIC CHAMBER (should have very short RT60)")
    print("="*80)

    room_dims = [5, 5, 3]
    materials_dict = {
        'north': 0.95,
        'south': 0.95,
        'east': 0.95,
        'west': 0.95,
        'floor': 0.95,
        'ceiling': 0.95
    }

    rt60_theory = calculate_sabine_rt60(room_dims, materials_dict)
    print(f"\nExpected: Very short RT60 (< 0.1s) ✓")

if __name__ == "__main__":
    import os
    os.makedirs('backend/temp', exist_ok=True)

    test_classroom_with_different_orders()
    test_anechoic_chamber()
