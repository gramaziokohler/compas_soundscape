"""
Test script to verify RT60 fix with automatic max_order calculation
"""
import requests
import json

API_BASE = "http://localhost:8000"

def test_scenarios():
    """Test three scenarios with automatic max_order"""

    scenarios = [
        {
            "name": "Classroom",
            "expected_rt60": 0.575,
            "request": {
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
                "settings": {"fs": 48000}  # No max_order = auto-calculate
            }
        },
        {
            "name": "Anechoic Chamber",
            "expected_rt60": 0.116,
            "request": {
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
                "settings": {"fs": 48000}  # No max_order = auto-calculate
            }
        },
        {
            "name": "Concert Hall",
            "expected_rt60": 2.0,
            "request": {
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
                "settings": {"fs": 48000}  # No max_order = auto-calculate
            }
        }
    ]

    print("\n" + "="*80)
    print("  RT60 FIX VERIFICATION TEST")
    print("="*80)

    for scenario in scenarios:
        print(f"\n{'='*80}")
        print(f"Scenario: {scenario['name']}")
        print(f"{'='*80}")

        response = requests.post(
            f"{API_BASE}/pyroomacoustics/simulate",
            json=scenario['request'],
            headers={"Content-Type": "application/json"}
        )

        if response.status_code == 200:
            data = response.json()

            print(f"✓ Status: {response.status_code} OK")
            print(f"✓ Computation time: {data['computation_time']:.3f}s")

            # Display RT60 comparison
            rt60_measured = data['acoustic_parameters']['rt60']
            rt60_theoretical = data['room_info']['theoretical_rt60']
            rt60_error = data['room_info']['rt60_error_percent']
            max_order_used = data['room_info']['max_order']

            print(f"\nRT60 Analysis:")
            print(f"  Theoretical RT60: {rt60_theoretical:.3f} s (Sabine formula)")
            print(f"  Measured RT60:    {rt60_measured:.3f} s (pyroomacoustics)")
            print(f"  Error:            {rt60_error:.1f}%")
            print(f"  Max order used:   {max_order_used}")

            # Color code the result
            if rt60_error < 20:
                status = "✓ EXCELLENT (< 20% error)"
            elif rt60_error < 30:
                status = "✓ GOOD (< 30% error)"
            elif rt60_error < 50:
                status = "⚠ FAIR (< 50% error)"
            else:
                status = "✗ POOR (> 50% error)"

            print(f"  Status:           {status}")

            # Display acoustic parameters
            print(f"\nAcoustic Parameters:")
            params = data['acoustic_parameters']
            print(f"  RT60: {params['rt60']:.3f} s")
            print(f"  EDT:  {params['edt']:.3f} s")
            print(f"  C50:  {params['c50']:.2f} dB")
            print(f"  C80:  {params['c80']:.2f} dB")
            print(f"  D50:  {params['d50']:.3f}")
            print(f"  DRR:  {params['drr']:.2f} dB")

        else:
            print(f"✗ Error: {response.status_code}")
            print(response.text)

    print(f"\n{'='*80}")
    print("  TEST COMPLETE")
    print(f"{'='*80}\n")

if __name__ == "__main__":
    test_scenarios()
