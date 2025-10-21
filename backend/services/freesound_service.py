import requests
import os
import sys
from utils.file_operations import sanitize_filename, ensure_directory

# --- API CONFIG STEP 1: https://freesound.org/apiv2/oauth2/authorize/?client_id=sa0EXwMTPDeI4iEKeKC3&response_type=code

# --- API CONFIG STEP 2: curl.exe -X POST -d "client_id=sa0EXwMTPDeI4iEKeKC3&client_secret=wjzu8KfuDgwqkJipeRskqTsRmXqNONrmXui3rEla&grant_type=authorization_code&code=PUTCODEHERE" https://freesound.org/apiv2/oauth2/access_token/

# --- Configuration ---
# IMPORTANT SECURITY NOTE: (As before)
FREESOUND_ACCESS_TOKEN = "U1WobU0M5niE7MIdRgMClkf2N2wZSv" # <-- YOUR PROVIDED ACCESS TOKEN

API_BASE_URL = "https://freesound.org/apiv2/"
SEARCH_ENDPOINT = "search/text/"
DOWNLOAD_DIR = "freesound_downloads" # Directory to save downloaded files

# --- Helper Functions --- (Now using centralized file_operations utility)

def search_freesound(query, access_token, count=3, sort_by="downloads_desc"):
    """
    Searches Freesound using Bearer Token Auth, sorts the results,
    and returns metadata for the top 'count' results.
    """
    search_url = f"{API_BASE_URL}{SEARCH_ENDPOINT}"
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {
        "query": query,
        "page_size": count,
        "fields": "id,name,previews,download,num_downloads",
        "sort": sort_by
    }

    print(f"Searching Freesound for: '{query}' (sorted by {sort_by})...")
    response = None
    try:
        response = requests.get(search_url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()
        return data.get("results", [])
    except requests.exceptions.RequestException as e:
        print(f"Error during API request: {e}")
        if response is not None:
            try:
                error_details = response.json()
                print(f"API Error Details: {error_details.get('detail', 'No details provided.')}")
                if response.status_code == 401:
                    print("Authentication failed. Check if the Access Token is correct and not expired.")
            except requests.exceptions.JSONDecodeError:
                print(f"Could not decode error response: {response.text}")
        return None
    except requests.exceptions.JSONDecodeError:
        print(f"Error decoding JSON response from API: {response.text}")
        return None

# *** MODIFIED download_sound to accept and use 'rank' ***
def download_sound(sound_info, access_token, download_dir, rank):
    """Downloads a single sound file using Bearer Token Auth and prepends rank to filename."""
    sound_id = sound_info.get("id")
    sound_name = sound_info.get("name", f"sound_{sound_id}")
    num_downloads = sound_info.get('num_downloads', 'N/A')
    download_url = sound_info.get("download")

    if not download_url:
        previews = sound_info.get("previews", {})
        download_url = previews.get("preview-hq-mp3") or previews.get("preview-hq-ogg")
        if download_url:
             print(f"Warning: Using preview URL for Rank {rank} '{sound_name}' (ID: {sound_id}) as direct download URL was not found.")
        else:
            print(f"Error: Could not find a downloadable URL for Rank {rank} '{sound_name}' (ID: {sound_id}). Skipping.")
            return False

    print(f"\nDownloading Rank {rank}: '{sound_name}' (ID: {sound_id}, Downloads: {num_downloads})...") # Added rank to print
    headers = {"Authorization": f"Bearer {access_token}"}
    response = None

    try:
        ensure_directory(download_dir)

        # Sanitize the original name first
        safe_original_name = sanitize_filename(sound_name)

        # Handle extension (append if needed)
        final_extension = ""
        base_name, ext = os.path.splitext(safe_original_name)
        if ext and len(ext) <= 5: # Use existing extension if valid
            final_extension = ext
            base_name_for_ranking = base_name # Keep base name without extension
        else:
            base_name_for_ranking = safe_original_name # Use the whole sanitized name if no extension
            # Guess extension if none was found in the name
            url_path = download_url.split('?')[0]
            guessed_ext = os.path.splitext(url_path)[1]
            if guessed_ext and len(guessed_ext) <= 5:
                final_extension = guessed_ext
            else:
                if "mp3" in download_url: final_extension = ".mp3"
                elif "ogg" in download_url: final_extension = ".ogg"
                else: final_extension = ".wav" # Default guess
            print(f"Guessed extension: appending '{final_extension}'")

        # *** Create the ranked filename ***
        # Format: rank_basename.extension
        ranked_filename = f"{rank}_{base_name_for_ranking}{final_extension}"

        filepath = os.path.join(download_dir, ranked_filename)

        # Download using streaming
        with requests.get(download_url, headers=headers, stream=True) as r:
            response = r
            r.raise_for_status()
            with open(filepath, 'wb') as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)

        print(f"Successfully downloaded to '{filepath}'") # Use the final filepath variable
        return True

    except requests.exceptions.RequestException as e:
        print(f"Error downloading Rank {rank} sound ID {sound_id}: {e}")
        if response is not None:
            if response.status_code == 401:
                print("Download failed due to authentication error (401). Check the Access Token.")
            else:
                print(f"Download failed with status {response.status_code}. Response: {response.text[:200]}...")
        return False
    except IOError as e:
        print(f"Error writing file for Rank {rank} sound ID {sound_id}: {e}")
        return False
    except Exception as e:
        print(f"An unexpected error occurred during download for Rank {rank} sound ID {sound_id}: {e}")
        return False


# --- Main Execution ---
if __name__ == "__main__":
    if not FREESOUND_ACCESS_TOKEN or FREESOUND_ACCESS_TOKEN == "YOUR_ACCESS_TOKEN_HERE":
        print("Error: The Freesound Access Token is missing or is a placeholder.")
        sys.exit(1)

    search_prompt = input("Enter your search prompt for Freesound: ")
    if not search_prompt:
        print("Search prompt cannot be empty.")
        sys.exit(1)

    results = search_freesound(search_prompt, FREESOUND_ACCESS_TOKEN, count=3) # Gets top 3 sorted by downloads

    if results is None:
        print("Failed to retrieve search results.")
        sys.exit(1)

    if not results:
        print(f"No results found for '{search_prompt}'.")
    else:
        print(f"\nFound {len(results)} result(s). Attempting to download the top {min(len(results), 3)} most downloaded:")
        download_count = 0
        # *** Use enumerate to get index (for rank) and sound data ***
        for index, sound_data in enumerate(results):
             rank = index + 1 # Calculate rank (1, 2, 3)
             # *** Pass the calculated rank to download_sound ***
             if download_sound(sound_data, FREESOUND_ACCESS_TOKEN, DOWNLOAD_DIR, rank):
                 download_count += 1

        print(f"\nFinished. Successfully downloaded {download_count} sound(s) to the '{DOWNLOAD_DIR}' directory.")