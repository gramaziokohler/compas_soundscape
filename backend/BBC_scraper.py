import requests
import csv
import time
import re

# --- CONFIGURATION ---
API_URL = "https://sound-effects-api.bbcrewind.co.uk/api/sfx/search"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Content-Type": "application/json",
    "Origin": "https://sound-effects.bbcrewind.co.uk",
    "Referer": "https://sound-effects.bbcrewind.co.uk/"
}

def clean_filename(text):
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', text)[:50]

def get_download_link(file_id, description):
    safe_desc = clean_filename(description)
    return f"https://sound-effects-media.bbcrewind.co.uk/zip/{file_id}.wav.zip?download&rename=BBC_{safe_desc}_{file_id}"

def search_bbc_exact_replica(keyword, max_results=50):
    results_list = []
    offset = 0
    batch_size = 20 # Website defaults to 20, let's match it to be safe
    
    print(f"\n--- Searching for '{keyword}' (Website Mode) ---")

    while len(results_list) < max_results:
        remaining = max_results - len(results_list)
        current_size = min(batch_size, remaining)

        # --- THE FIX ---
        # We now use "query" instead of "term".
        # We also include the null fields to match the website payload exactly.
        payload = {
            "criteria": {
                "query": keyword,  # Changed from 'term' to 'query'
                "from": offset,
                "size": current_size,
                # Including these nulls mimics the website's exact footprint
                "tags": None,
                "categories": None,
                "durations": None,
                "continents": None,
                "sortBy": None,
                "source": None,
                "habitat": None,
                "recordist": None
            }
        }

        try:
            response = requests.post(API_URL, json=payload, headers=HEADERS)
            
            if response.status_code != 200:
                print(f"  [Error] API Status: {response.status_code}")
                break

            data = response.json()
            items = data.get('results', [])

            if not items:
                print("  [Info] No more results found.")
                break

            for item in items:
                s_id = item.get('id')
                desc = item.get('description', 'No Description')
                cat = item.get('category', 'Uncategorized')
                dur = item.get('duration', 0)
                link = get_download_link(s_id, desc)

                results_list.append({
                    "ID": s_id,
                    "Description": desc,
                    "Category": cat,
                    "Duration_Sec": dur,
                    "Download_Link": link
                })

            print(f"  Fetched {len(items)} items... (Total: {len(results_list)})")
            
            if offset >= 900:
                print("  [Limit] Reached 1000-item depth limit.")
                break

            offset += len(items)
            time.sleep(0.2)

        except Exception as e:
            print(f"  [Exception] {e}")
            break

    return results_list

def save_to_csv(data, keyword):
    if not data:
        print("No data to save.")
        return

    filename = f"bbc_sfx_{clean_filename(keyword)}.csv"
    keys = ["ID", "Description", "Category", "Duration_Sec", "Download_Link"]
    
    with open(filename, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(data)
        
    print(f"\n[Success] Saved {len(data)} files to: {filename}")

if __name__ == "__main__":
    user_keyword = input("Enter search keyword (e.g., speaking): ").strip()
    
    try:
        user_limit = int(input("Max results (e.g., 50): ").strip())
    except ValueError:
        user_limit = 50

    if user_keyword:
        found_data = search_bbc_exact_replica(user_keyword, user_limit)
        save_to_csv(found_data, user_keyword)
    else:
        print("Keyword cannot be empty.")