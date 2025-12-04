import requests
import json
import time

# Configuration
BASE_URL = 'http://localhost:5001/simulations/cancel'
HEADERS = {
    'accept': 'application/json',
    'Content-Type': 'application/json'
}

def cancel_all_simulations():
    print("Starting cancellation of simulations 0 through 100...")
    
    # Loop from 0 to 100 (inclusive)
    for i in range(101):
        payload = {"simulationId": i}
        
        try:
            response = requests.post(
                BASE_URL, 
                headers=HEADERS, 
                json=payload,
                timeout=5 # Prevent hanging indefinitely
            )
            
            # Check for success (200 OK or 204 No Content are typical)
            if response.status_code in [200, 204]:
                print(f"[SUCCESS] Cancelled simulation {i}")
            else:
                print(f"[FAILED] Simulation {i}: Server returned {response.status_code} - {response.text}")
                
        except requests.exceptions.ConnectionError:
            print(f"[ERROR] Simulation {i}: Could not connect to localhost:5001")
        except Exception as e:
            print(f"[ERROR] Simulation {i}: {e}")

if __name__ == "__main__":
    # Ensure requests is installed
    try:
        cancel_all_simulations()
    except NameError:
        print("Please run: pip install requests")