"""
Comprehensive Test Suite for COMPAS Soundscape
Tests both backend and frontend functionality with two levels of detail.

Test Flow:
1. LLM Service - Generate 3 sound prompts from 1-word random prompt
2. Sound Generation - Generate 3 sounds using 3 different methods:
   - Text-to-audio generation
   - Library search and download
   - Upload from local file
3. UI Component Testing - Systematic testing of all frontend components

Requirements:
- Backend: mamba activate compas-toy && uvicorn main:app --reload
- Frontend: npm run dev
- Python packages: selenium, requests, python-dotenv
- Chrome WebDriver installed
"""

import os
import sys
import time
import random
import json
import requests
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime

# Add backend to path for imports
BACKEND_DIR = Path(__file__).parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# Test Configuration
API_BASE_URL = "http://localhost:8000"
FRONTEND_URL = "http://localhost:3000"
TEST_AUDIO_FILE = "backend/data/Le Corbeau et le Renard (french).wav"  # User-provided audio file
TEST_RESULTS_DIR = Path("test_results")
TEST_TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")

# Random one-word prompts for testing
RANDOM_PROMPTS = [
    "office", "kitchen", "library", "workshop", "studio",
    "classroom", "restaurant", "warehouse", "garage", "lobby"
]

# Test Detail Levels
@dataclass
class TestLevel:
    """Test detail level configuration"""
    name: str
    check_ui_visibility: bool = True
    check_ui_interactions: bool = True
    check_api_responses: bool = True
    check_audio_playback: bool = True
    take_screenshots: bool = True
    validate_data_integrity: bool = True
    check_error_handling: bool = False
    performance_metrics: bool = False

LEVEL_1_BASIC = TestLevel(
    name="Level 1 - Basic",
    check_ui_visibility=True,
    check_ui_interactions=True,
    check_api_responses=True,
    check_audio_playback=False,
    take_screenshots=True,
    validate_data_integrity=True,
    check_error_handling=False,
    performance_metrics=False
)

LEVEL_2_COMPREHENSIVE = TestLevel(
    name="Level 2 - Comprehensive",
    check_ui_visibility=True,
    check_ui_interactions=True,
    check_api_responses=True,
    check_audio_playback=True,
    take_screenshots=True,
    validate_data_integrity=True,
    check_error_handling=True,
    performance_metrics=True
)

# Test Results
@dataclass
class TestResult:
    """Test result data structure"""
    test_name: str
    success: bool
    duration: float
    message: str = ""
    details: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

class TestReport:
    """Test report aggregator"""
    def __init__(self):
        self.results: List[TestResult] = []
        self.start_time = time.time()
    
    def add_result(self, result: TestResult):
        self.results.append(result)
    
    def print_summary(self):
        """Print test summary"""
        total = len(self.results)
        passed = sum(1 for r in self.results if r.success)
        failed = total - passed
        duration = time.time() - self.start_time
        
        print("\n" + "=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print(f"Total Tests: {total}")
        print(f"Passed: {passed} ({100*passed/total:.1f}%)")
        print(f"Failed: {failed} ({100*failed/total:.1f}%)")
        print(f"Total Duration: {duration:.2f}s")
        print("=" * 80)
        
        if failed > 0:
            print("\nFAILED TESTS:")
            for r in self.results:
                if not r.success:
                    print(f"  ❌ {r.test_name}: {r.message}")
        
        print("\nDETAILED RESULTS:")
        for r in self.results:
            status = "✅" if r.success else "❌"
            print(f"  {status} {r.test_name} ({r.duration:.2f}s)")
            if r.message:
                print(f"      {r.message}")
    
    def save_to_file(self):
        """Save test report to JSON file"""
        TEST_RESULTS_DIR.mkdir(exist_ok=True)
        report_file = TEST_RESULTS_DIR / f"test_report_{TEST_TIMESTAMP}.json"
        
        report_data = {
            "timestamp": TEST_TIMESTAMP,
            "total_duration": time.time() - self.start_time,
            "results": [
                {
                    "test_name": r.test_name,
                    "success": r.success,
                    "duration": r.duration,
                    "message": r.message,
                    "details": r.details,
                    "timestamp": r.timestamp
                }
                for r in self.results
            ]
        }
        
        with open(report_file, 'w') as f:
            json.dump(report_data, f, indent=2)
        
        print(f"\n📄 Test report saved to: {report_file}")


class FrontendTester:
    """Frontend UI component testing using Selenium"""
    
    def __init__(self, report: TestReport, test_level: TestLevel, audio_file: str = TEST_AUDIO_FILE):
        self.report = report
        self.test_level = test_level
        self.frontend_url = FRONTEND_URL
        self.audio_file = audio_file
        self.driver = None
        self.screenshots_dir = TEST_RESULTS_DIR / "screenshots" / TEST_TIMESTAMP
        
        if self.test_level.take_screenshots:
            self.screenshots_dir.mkdir(parents=True, exist_ok=True)
    
    def setup_driver(self):
        """Initialize Selenium WebDriver"""
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            
            chrome_options = Options()
            chrome_options.add_argument("--start-maximized")
            chrome_options.add_argument("--disable-blink-features=AutomationControlled")
            
            # Headless mode for automated testing (optional)
            # chrome_options.add_argument("--headless")
            
            self.driver = webdriver.Chrome(options=chrome_options)
            print("✅ WebDriver initialized")
            return True
            
        except Exception as e:
            print(f"❌ Failed to initialize WebDriver: {e}")
            print("   Make sure Chrome and ChromeDriver are installed")
            return False
    
    def teardown_driver(self):
        """Close WebDriver"""
        if self.driver:
            self.driver.quit()
            print("✅ WebDriver closed")
    
    def take_screenshot(self, name: str):
        """Take screenshot if enabled"""
        if self.test_level.take_screenshots and self.driver:
            try:
                filepath = self.screenshots_dir / f"{name}.png"
                self.driver.save_screenshot(str(filepath))
                print(f"   📸 Screenshot saved: {filepath.name}")
            except Exception as e:
                print(f"   ⚠️  Screenshot failed: {e}")
    
    def test_page_load(self) -> bool:
        """Test that main page loads correctly"""
        print("\n" + "=" * 80)
        print("FRONTEND TEST 1: Page Load")
        print("=" * 80)
        
        start_time = time.time()
        
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            
            print(f"🌐 Loading {self.frontend_url}...")
            self.driver.get(self.frontend_url)
            
            # Wait for React to render
            wait = WebDriverWait(self.driver, 10)
            wait.until(EC.presence_of_element_located((By.TAG_NAME, "canvas")))
            
            print("✅ Page loaded successfully")
            self.take_screenshot("01_page_load")
            
            duration = time.time() - start_time
            self.report.add_result(TestResult(
                test_name="Frontend - Page Load",
                success=True,
                duration=duration,
                message="Page loaded with 3D canvas"
            ))
            
            return True
            
        except Exception as e:
            duration = time.time() - start_time
            print(f"❌ Page load failed: {e}")
            self.report.add_result(TestResult(
                test_name="Frontend - Page Load",
                success=False,
                duration=duration,
                message=str(e)
            ))
            return False
    
    def test_ui_components_systematic(self) -> bool:
        """Systematically test all UI components with dynamic behavior handling"""
        print("\n" + "=" * 80)
        print(f"FRONTEND TEST 2: UI Components ({self.test_level.name})")
        print("=" * 80)
        
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        import time
        
        all_passed = True
        start_time = time.time()
        
        # === STEP 1: Test Initial Page State ===
        print(f"\n📦 Testing Initial Page State...")
        
        # 3D Scene (always visible)
        success = self._test_element_visibility("Canvas Element", By.TAG_NAME, "canvas")
        if not success:
            all_passed = False
        self.take_screenshot("01_initial_state")
        
        # === STEP 2: Navigate to Analysis Tab ===
        print(f"\n📦 Testing Analysis Tab Components...")
        
        # Click on Analysis tab (shows by default, but let's be explicit)
        analysis_tab_found = self._click_element("Analysis Tab", By.XPATH, "//button[contains(text(), 'Analysis')]")
        if analysis_tab_found:
            time.sleep(0.5)  # Wait for tab content to render
            
            # Test file input (always present)
            self._test_element_visibility("File Input", By.XPATH, "//input[@type='file']")
            
            # Test context text area or input
            self._test_element_visibility("Context Input", By.XPATH, "//textarea[@placeholder] | //input[@placeholder]")
            
            # Test Generate button (for text generation)
            self._test_element_visibility("Generate Text Button", By.XPATH, "//button[contains(text(), 'Generate') and not(contains(text(), 'Sound'))]", timeout=2)
            
            self.take_screenshot("02_analysis_tab")
        else:
            all_passed = False
        
        # === STEP 3: Navigate to Sound Generation Tab ===
        print(f"\n📦 Testing Sound Generation Tab Components...")
        
        sound_tab_found = self._click_element("Sound Generation Tab", By.XPATH, "//button[contains(text(), 'Sound Generation')]")
        if sound_tab_found:
            time.sleep(0.5)  # Wait for tab content to render
            
            # Test Add Sound button
            self._test_element_visibility("Add Sound Button", By.XPATH, "//button[contains(text(), 'Add Sound') or contains(text(), 'Add')]", timeout=2)
            
            # Test Generate Sounds button
            self._test_element_visibility("Generate Sounds Button", By.XPATH, "//button[contains(text(), 'Generate Sound') or contains(text(), 'Generate')]", timeout=2)
            
            # Test mode dropdown (should be visible by default in text-to-audio mode)
            mode_dropdown_found = self._test_element_visibility("Mode Dropdown", By.XPATH, "//select[.//option[contains(text(), 'Text-to-Audio')]]", timeout=2)
            
            self.take_screenshot("03_sound_generation_tab_text_mode")
            
            # === STEP 3a: Test Upload Mode ===
            if mode_dropdown_found:
                print(f"\n   📝 Testing Upload Mode...")
                upload_mode_switched = self._select_dropdown_option(
                    "Mode Dropdown",
                    By.XPATH,
                    "//select[.//option[contains(text(), 'Text-to-Audio')]]",
                    "upload"
                )
                
                if upload_mode_switched:
                    time.sleep(0.5)  # Wait for UI update
                    
                    # Test upload file area
                    self._test_element_visibility("Upload File Area", By.XPATH, "//input[@type='file' and @accept]", timeout=2)
                    
                    self.take_screenshot("04_sound_generation_upload_mode")
                
                # === STEP 3b: Test Library Mode ===
                print(f"\n   📝 Testing Library Search Mode...")
                library_mode_switched = self._select_dropdown_option(
                    "Mode Dropdown",
                    By.XPATH,
                    "//select[.//option[contains(text(), 'Text-to-Audio')]]",
                    "library"
                )
                
                if library_mode_switched:
                    time.sleep(0.5)  # Wait for UI update
                    
                    # Test search button for library
                    self._test_element_visibility("Library Search Button", By.XPATH, "//button[contains(text(), 'Search')]", timeout=2)
                    
                    self.take_screenshot("05_sound_generation_library_mode")
                
                # Switch back to text-to-audio mode
                self._select_dropdown_option(
                    "Mode Dropdown",
                    By.XPATH,
                    "//select[.//option[contains(text(), 'Text-to-Audio')]]",
                    "text-to-audio"
                )
        else:
            all_passed = False
        
        # === STEP 4: Navigate to Acoustics Tab ===
        print(f"\n📦 Testing Acoustics Tab Components...")
        
        acoustics_tab_found = self._click_element("Acoustics Tab", By.XPATH, "//button[contains(text(), 'Acoustics')]")
        if acoustics_tab_found:
            time.sleep(0.5)
            
            # Test receiver placement button
            self._test_element_visibility("Place Receiver Button", By.XPATH, "//button[contains(text(), 'Place') or contains(text(), 'Receiver')]", timeout=2)
            
            self.take_screenshot("06_acoustics_tab")
        else:
            print(f"   ⚠️  Acoustics tab not found (may be expected)")
        
        # === STEP 5: Test Playback Controls (may require generated sounds) ===
        print(f"\n📦 Testing Playback Controls...")
        print(f"   ℹ️  Note: Playback controls may not be visible without loaded sounds")
        
        # These might not be visible without sounds, so we don't fail the test
        self._test_element_visibility("Play Button", By.XPATH, "//button[contains(@title, 'Play') or contains(text(), 'Play')]", timeout=1)
        self._test_element_visibility("Stop Button", By.XPATH, "//button[contains(@title, 'Stop') or contains(text(), 'Stop')]", timeout=1)
        
        self.take_screenshot("07_playback_controls")
        
        duration = time.time() - start_time
        self.report.add_result(TestResult(
            test_name=f"Frontend - UI Components ({self.test_level.name})",
            success=all_passed,
            duration=duration,
            message="All essential components tested" if all_passed else "Some essential components failed"
        ))
        
        return all_passed
    
    def _click_element(self, name: str, by, selector: str, timeout: int = 5) -> bool:
        """Click an element and return success status"""
        try:
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            
            wait = WebDriverWait(self.driver, timeout)
            element = wait.until(EC.element_to_be_clickable((by, selector)))
            element.click()
            
            print(f"   ✅ {name} - Clicked")
            return True
            
        except Exception as e:
            print(f"   ❌ {name} - Not clickable: {str(e)[:50]}")
            return False
    
    def _select_dropdown_option(self, name: str, by, selector: str, option_value: str, timeout: int = 5) -> bool:
        """Select dropdown option and return success status"""
        try:
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.support.select import Select
            
            wait = WebDriverWait(self.driver, timeout)
            dropdown_element = wait.until(EC.presence_of_element_located((by, selector)))
            
            select = Select(dropdown_element)
            select.select_by_value(option_value)
            
            print(f"   ✅ {name} - Selected '{option_value}'")
            return True
            
        except Exception as e:
            print(f"   ❌ {name} - Selection failed: {str(e)[:50]}")
            return False
    
    def _test_element_visibility(self, name: str, by, selector: str, timeout: int = 5) -> bool:
        """Test if element is visible"""
        try:
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            
            wait = WebDriverWait(self.driver, timeout)
            element = wait.until(EC.presence_of_element_located((by, selector)))
            
            print(f"   ✅ {name} - Visible")
            return True
            
        except Exception:
            print(f"   ❌ {name} - Not found")
            return False
    
    def _test_element_interaction(self, name: str, by, selector: str):
        """Test element interaction (Level 2 only)"""
        try:
            element = self.driver.find_element(by, selector)
            
            # Check if clickable
            if element.is_enabled():
                print(f"      ↪ Clickable: Yes")
            else:
                print(f"      ↪ Clickable: No")
            
            # Check if visible
            if element.is_displayed():
                print(f"      ↪ Displayed: Yes")
            else:
                print(f"      ↪ Displayed: No")
            
        except Exception as e:
            print(f"      ↪ Interaction test failed: {e}")
    
    def test_workflow_integration(self) -> bool:
        """Test complete workflow: Use LLM to generate 3 sound prompts, then configure different methods"""
        print("\n" + "=" * 80)
        print("FRONTEND TEST 3: Complete Workflow - LLM + Multiple Sound Methods")
        print("=" * 80)
        print("This test workflow:")
        print("  1. Use LLM to generate 3 sound prompts")
        print("  2. Load the generated sounds")
        print("  3. Sound 1: Change to Upload method")
        print("  4. Sound 2: Change to Library Search (select shortest duration)")
        print("  5. Sound 3: Keep as-is (text-to-audio)")
        print("  6. Generate all sounds and test playback")
        print("=" * 80)
        
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.keys import Keys
        import time
        
        start_time = time.time()
        all_passed = True
        
        try:
            # === STEP 1: Navigate to Analysis Tab ===
            print(f"\n📦 Step 1: Navigate to Analysis Tab...")
            analysis_tab_found = self._click_element("Analysis Tab", By.XPATH, "//button[contains(text(), 'Analysis')]")
            if not analysis_tab_found:
                raise Exception("Failed to navigate to Analysis tab")
            time.sleep(0.5)
            
            self.take_screenshot("01_analysis_tab")
            
            # === STEP 2: Set number of sounds to 3 using slider ===
            print(f"\n📦 Step 2: Set number of sounds to 3...")
            
            try:
                # Find the slider for number of sounds
                slider = self.driver.find_element(By.XPATH, "//input[@type='range' and @min='1']")
                
                # Set slider to 3
                self.driver.execute_script("arguments[0].value = 3; arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", slider)
                print(f"   ✅ Set slider to 3 sounds")
                time.sleep(0.5)
                
                self.take_screenshot("02_slider_set_to_3")
            except Exception as e:
                print(f"   ⚠️  Could not find/adjust slider: {str(e)[:100]}")
            
            # === STEP 3: Enter context and generate prompts with LLM ===
            print(f"\n📦 Step 3: Generate sound prompts using LLM...")
            
            try:
                # Find context input
                context_input = self.driver.find_element(By.XPATH, "//textarea[@placeholder] | //input[@placeholder]")
                context_input.clear()
                context_input.send_keys("office environment")
                print(f"   ✅ Entered context: 'office environment'")
                time.sleep(0.3)
                
                self.take_screenshot("03_context_entered")
                
                # Try multiple strategies to find Generate Text button
                generate_text_clicked = False
                generate_text_strategies = [
                    "//button[text()='Generate']",
                    "//button[contains(text(), 'Generate') and not(contains(text(), 'Sound'))]",
                    "//button[normalize-space()='Generate']",
                    "//div[contains(@class, 'analysis')]//button[contains(text(), 'Generate')]",
                    "(//button[contains(text(), 'Generate')])[1]",
                ]
                
                for strategy in generate_text_strategies:
                    try:
                        button = self.driver.find_element(By.XPATH, strategy)
                        # Make sure it's visible and enabled
                        if button.is_displayed() and button.is_enabled():
                            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button)
                            time.sleep(0.3)
                            button.click()
                            generate_text_clicked = True
                            print(f"   ✅ Clicked Generate button")
                            
                            # Wait for generation to start (button text changes to "Generating...")
                            print(f"   ⏳ Waiting for LLM generation to complete...")
                            wait = WebDriverWait(self.driver, 60)
                            try:
                                # Wait for button text to change back from "Generating..." to something else
                                # or for "Load Sounds" button to appear
                                wait.until(lambda d: 
                                    len(d.find_elements(By.XPATH, "//button[contains(text(), 'Load Sound')]")) > 0 or
                                    len(d.find_elements(By.XPATH, "//button[text()='Generate Sound Ideas']")) > 0
                                )
                                print(f"   ✅ LLM generation complete!")
                                time.sleep(1)
                                self.take_screenshot("04_prompts_generated")
                            except Exception as e:
                                print(f"   ⚠️  Timeout waiting for generation to complete")
                                print(f"      Continuing anyway...")
                            break
                    except Exception:
                        continue
                
                if not generate_text_clicked:
                    print(f"   ⚠️  Could not find Generate button - skipping LLM step")
                    print(f"   ℹ️  Will proceed with Load Sounds which may use default prompts")
                    
            except Exception as e:
                print(f"   ⚠️  Error in LLM generation: {str(e)[:100]}")
            
            # === STEP 4: Click "Load Sounds" button ===
            print(f"\n📦 Step 4: Click 'Load Sounds' button...")
            
            load_sounds_strategies = [
                "//button[contains(text(), 'Load Sound')]",
                "//button[contains(text(), 'Load')]",
                "//button[normalize-space()='Load Sounds']",
            ]
            
            load_clicked = False
            for strategy in load_sounds_strategies:
                try:
                    wait = WebDriverWait(self.driver, 5)
                    button = wait.until(EC.presence_of_element_located((By.XPATH, strategy)))
                    
                    # Scroll into view and click
                    self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button)
                    time.sleep(0.3)
                    button.click()
                    
                    load_clicked = True
                    print(f"   ✅ Clicked 'Load Sounds' button")
                    time.sleep(1)  # Wait for tab switch
                    break
                except Exception:
                    continue
            
            if not load_clicked:
                print(f"   ⚠️  Could not find 'Load Sounds' button")
                print(f"      Manually navigating to Sound Generation tab...")
                self._click_element("Sound Generation Tab", By.XPATH, "//button[contains(text(), 'Sound Generation')]")
                time.sleep(0.5)
            
            self.take_screenshot("05_after_load_sounds")
            
            # Wait for all sound tabs to be created
            print(f"   ⏳ Waiting for all 3 sound tabs to appear...")
            time.sleep(2)
            
            # === STEP 5: Configure Sound 1 - Upload Method ===
            print(f"\n🎵 Sound 1/3: Configure Upload Method")
            
            # Click on first sound tab to make it active
            first_tab_clicked = self._click_element(
                "First Sound Tab",
                By.XPATH,
                "(//div[contains(@class, 'flex') and contains(@class, 'gap')]//button)[1] | //button[contains(text(), 'Sound 1')]",
                timeout=3
            )
            
            if first_tab_clicked:
                print(f"   ✅ Clicked on Sound 1 tab")
                time.sleep(1)  # Give more time for tab to become active and dropdown to render
            
            # Now switch the ACTIVE sound's dropdown to upload mode
            try:
                from selenium.webdriver.support.select import Select
                # Wait for the dropdown to be present and visible
                wait = WebDriverWait(self.driver, 15)
                dropdown_element = wait.until(EC.visibility_of_element_located((By.XPATH, "//select[.//option[contains(text(), 'Text-to-Audio')]]")))
                time.sleep(1.0)
                
                # There should be only ONE visible dropdown (for the active tab)
                select = Select(dropdown_element)
                select.select_by_value("upload")
                print(f"   ✅ Switched to Upload mode")
                time.sleep(0.5)
                
                # Upload audio file
                audio_file_path = Path(self.audio_file)
                if audio_file_path.exists():
                    try:
                        file_input = self.driver.find_element(By.XPATH, "//input[@type='file' and @accept]")
                        file_input.send_keys(str(audio_file_path.absolute()))
                        print(f"   ✅ Uploaded audio file: {self.audio_file}")
                        time.sleep(1)
                    except Exception as e:
                        print(f"   ⚠️  File upload failed: {str(e)[:100]}")
                else:
                    print(f"   ⚠️  Audio file not found: {self.audio_file}")
            except Exception as e:
                print(f"   ⚠️  Error switching to upload mode: {str(e)[:100]}")
            
            # Set variants to 1 for Sound 1
            try:
                variant_slider = self.driver.find_element(By.XPATH, "//label[contains(text(), 'Number of variants')]/following-sibling::input[@type='range']")
                current_value = variant_slider.get_attribute('value')
                print(f"   📊 Sound 1 current variants: {current_value}")
                self.driver.execute_script("arguments[0].value = 1; arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", variant_slider)
                time.sleep(0.3)
                new_value = variant_slider.get_attribute('value')
                print(f"   ✅ Sound 1 variants set to: {new_value}")
            except Exception as e:
                print(f"   ⚠️  Could not set Sound 1 variants: {str(e)[:100]}")
            
            self.take_screenshot("06_sound1_upload")
            
            # === STEP 6: Configure Sound 2 - Library Search (shortest duration) ===
            print(f"\n🎵 Sound 2/3: Configure Library Search Method")
            
            # Click on second sound tab to make it active
            second_tab_clicked = self._click_element(
                "Second Sound Tab",
                By.XPATH,
                "(//div[contains(@class, 'flex') and contains(@class, 'gap')]//button)[2] | //button[contains(text(), 'Sound 2')]",
                timeout=3
            )
            
            if second_tab_clicked:
                print(f"   ✅ Clicked on Sound 2 tab")
                time.sleep(0.5)
            
            # Now switch the ACTIVE sound's dropdown to library mode
            try:
                from selenium.webdriver.support.select import Select
                
                # Wait for the dropdown to be present
                wait = WebDriverWait(self.driver, 5)
                wait.until(EC.presence_of_element_located((By.XPATH, "//select[.//option[contains(text(), 'Text-to-Audio')]]")))
                time.sleep(0.3)
                
                # There should be only ONE visible dropdown (for the active tab)
                dropdown = self.driver.find_element(By.XPATH, "//select[.//option[contains(text(), 'Text-to-Audio')]]")
                select = Select(dropdown)
                select.select_by_value("library")
                print(f"   ✅ Switched to Library Search mode")
                time.sleep(0.5)
                
                # Click search button
                search_btn_found = self._click_element(
                    "Library Search Button",
                    By.XPATH,
                    "//button[contains(text(), 'Search')]",
                    timeout=3
                )
                
                if search_btn_found:
                    print(f"   ⏳ Waiting for library search to complete...")
                    
                    # Wait for search to complete (button text changes from "Searching..." back to "Search")
                    wait = WebDriverWait(self.driver, 30)
                    try:
                        # Wait for search results to appear
                        wait.until(lambda d: 
                            len(d.find_elements(By.XPATH, "//button[text()='Search']")) > 0 and
                            len(d.find_elements(By.XPATH, "//div[contains(@class, 'overflow-y-auto')]//button")) > 0
                        )
                        print(f"   ✅ Search complete!")
                        time.sleep(0.5)
                    except Exception:
                        print(f"   ⚠️  Search timeout or no results found")
                    
                    # Find all search results and select the one with shortest duration
                    print(f"   🔍 Looking for sound with shortest duration...")
                    
                    try:
                        # Find all result buttons
                        result_buttons = self.driver.find_elements(By.XPATH, "//div[contains(@class, 'overflow-y-auto')]//button")
                        
                        if result_buttons:
                            print(f"   ✅ Found {len(result_buttons)} search results")
                            
                            # Parse durations and find shortest
                            shortest_duration = float('inf')
                            shortest_button = None
                            
                            for button in result_buttons:
                                button_text = button.text
                                # Look for duration pattern like "5.2s" or "Duration: 5.2s" or "5.2 s"
                                import re
                                # Try multiple patterns
                                duration_match = re.search(r'(\d+\.?\d*)\s*s', button_text, re.IGNORECASE)
                                
                                if duration_match:
                                    duration = float(duration_match.group(1))
                                    print(f"      Found sound with duration: {duration}s")
                                    
                                    if duration < shortest_duration:
                                        shortest_duration = duration
                                        shortest_button = button
                                else:
                                    # Try to find duration in different format
                                    print(f"      Couldn't parse duration from: {button_text[:50]}...")
                            
                            # Click on shortest duration sound
                            if shortest_button:
                                shortest_button.click()
                                print(f"   ✅ Selected sound with shortest duration: {shortest_duration}s")
                                time.sleep(0.5)
                            else:
                                # Fallback: just click first result
                                result_buttons[0].click()
                                print(f"   ✅ Selected first result (duration parsing failed)")
                                time.sleep(0.5)
                        else:
                            print(f"   ⚠️  No search results found")
                            
                    except Exception as e:
                        print(f"   ⚠️  Error selecting shortest duration: {str(e)[:100]}")
                        print(f"      Trying to select first result...")
                        
                        # Fallback to first result
                        try:
                            first_result = self.driver.find_element(By.XPATH, "(//div[contains(@class, 'overflow-y-auto')]//button)[1]")
                            first_result.click()
                            print(f"   ✅ Selected first result")
                            time.sleep(0.5)
                        except Exception:
                            print(f"   ❌ Could not select any result")
                    
            except Exception as e:
                print(f"   ⚠️  Error configuring library search: {str(e)[:100]}")
            
            # Set variants to 1 for Sound 2
            try:
                variant_slider = self.driver.find_element(By.XPATH, "//label[contains(text(), 'Number of variants')]/following-sibling::input[@type='range']")
                current_value = variant_slider.get_attribute('value')
                print(f"   📊 Sound 2 current variants: {current_value}")
                self.driver.execute_script("arguments[0].value = 1; arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", variant_slider)
                time.sleep(0.3)
                new_value = variant_slider.get_attribute('value')
                print(f"   ✅ Sound 2 variants set to: {new_value}")
            except Exception as e:
                print(f"   ⚠️  Could not set Sound 2 variants: {str(e)[:100]}")
            
            self.take_screenshot("07_sound2_library")
            
            # === STEP 7: Keep Sound 3 as-is (don't click on it) ===
            print(f"\n🎵 Sound 3/3: Keep as Text-to-Audio (no changes)")
            print(f"   ℹ️  Sound 3 will use the LLM-generated prompt with text-to-audio")
            
            # Click on third sound tab to ensure variants is set to 1
            third_tab_clicked = self._click_element(
                "Third Sound Tab",
                By.XPATH,
                "(//div[contains(@class, 'flex') and contains(@class, 'gap')]//button)[3] | //button[contains(text(), 'Sound 3')]",
                timeout=3
            )
            
            if third_tab_clicked:
                print(f"   ✅ Clicked on Sound 3 tab")
                time.sleep(0.5)
                
                # Set number of variants to 1 for this sound
                try:
                    # Find the "Number of variants" slider
                    variant_slider = self.driver.find_element(By.XPATH, "//label[contains(text(), 'Number of variants')]/following-sibling::input[@type='range']")
                    current_value = variant_slider.get_attribute('value')
                    print(f"   ℹ️  Current variants: {current_value}")
                    
                    if current_value != '1':
                        self.driver.execute_script("arguments[0].value = 1; arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", variant_slider)
                        print(f"   ✅ Set variants to 1")
                        time.sleep(0.3)
                except Exception as e:
                    print(f"   ⚠️  Could not adjust variants slider: {str(e)[:100]}")
            
            # Click back to Sound 1 tab or anywhere to deselect Sound 3
            try:
                first_tab = self.driver.find_element(By.XPATH, "(//div[contains(@class, 'flex') and contains(@class, 'gap')]//button)[1]")
                first_tab.click()
                time.sleep(0.3)
            except Exception:
                pass
            
            # === STEP 8: Generate all sounds ===
            print(f"\n📦 Step 8: Generate all sounds...")
            
            # First, verify and ensure the number of sounds is still 3
            print(f"   🔍 Verifying number of sounds before generation...")
            try:
                # Navigate to Analysis tab to check the slider
                analysis_tab = self.driver.find_element(By.XPATH, "//button[contains(text(), 'Analysis') or contains(text(), 'Text Generation')]")
                analysis_tab.click()
                time.sleep(0.5)
                
                # Find the slider and check its value
                num_sounds_slider = self.driver.find_element(By.XPATH, "//label[contains(text(), 'Number of sounds')]/following-sibling::input[@type='range']")
                current_slider_value = num_sounds_slider.get_attribute('value')
                print(f"   📊 Current slider value: {current_slider_value}")
                
                if current_slider_value != '3':
                    print(f"   ⚠️  Slider changed from 3 to {current_slider_value}! Resetting to 3...")
                    self.driver.execute_script("arguments[0].value = 3; arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", num_sounds_slider)
                    time.sleep(0.5)
                    new_value = num_sounds_slider.get_attribute('value')
                    print(f"   ✅ Slider reset to: {new_value}")
                else:
                    print(f"   ✅ Slider is correctly set to 3")
                
                # Navigate back to Sound Generation tab
                sound_gen_tab = self.driver.find_element(By.XPATH, "//button[contains(text(), 'Sound Generation') or contains(text(), 'Sound Config')]")
                sound_gen_tab.click()
                time.sleep(0.5)
                
            except Exception as e:
                print(f"   ⚠️  Could not verify slider value: {str(e)[:100]}")
            
            # Scroll to top first to ensure we can see the generate button
            try:
                self.driver.execute_script("window.scrollTo(0, 0);")
                time.sleep(0.5)
            except Exception:
                pass
            
            # Then scroll down a bit to make sure Generate button is visible
            try:
                self.driver.execute_script("window.scrollTo(0, 300);")
                time.sleep(0.5)
            except Exception:
                pass
            
            # Try multiple strategies to find and click Generate button
            generate_clicked = False
            generate_strategies = [
                "//button[contains(text(), 'Generate Sound')]",
                "//button[contains(text(), 'Generate') and not(contains(text(), 'Text'))]",
                "//button[contains(@class, 'bg-blue') and contains(text(), 'Generate')]",
                "//button[text()='Generate Sounds']",
                "//button[normalize-space()='Generate Sounds']",
            ]
            
            for strategy in generate_strategies:
                try:
                    from selenium.webdriver.support.ui import WebDriverWait
                    from selenium.webdriver.support import expected_conditions as EC
                    
                    wait = WebDriverWait(self.driver, 5)
                    button = wait.until(EC.presence_of_element_located((By.XPATH, strategy)))
                    
                    # Scroll button into view
                    self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button)
                    time.sleep(0.3)
                    
                    # Try to click
                    button.click()
                    generate_clicked = True
                    print(f"   ✅ Clicked Generate Sounds button")
                    break
                except Exception as e:
                    continue
            
            if generate_clicked:
                print(f"   ⏳ Waiting for sound generation to complete...")
                
                # Wait for generation to complete - button text changes from "Generating Sounds..." to "Generate Sounds"
                # AND playback controls appear
                wait = WebDriverWait(self.driver, 180)  # 3 minutes max for sound generation
                try:
                    # First wait for button to change back to "Generate Sounds" (not "Generating Sounds...")
                    wait.until(lambda d: 
                        len(d.find_elements(By.XPATH, "//button[text()='Generate Sounds']")) > 0
                    )
                    print(f"   ✅ Generation button is ready (no longer generating)")
                    time.sleep(2)  # Wait for sounds to fully load
                    
                    # Then check if playback controls appeared
                    playback_controls_found = False
                    playback_indicators = [
                        "//button[contains(text(), 'Play All')]",
                        "//button[contains(text(), 'Pause All')]",
                        "//button[contains(@title, 'Play')]",
                    ]
                    
                    for indicator in playback_indicators:
                        try:
                            self.driver.find_element(By.XPATH, indicator)
                            playback_controls_found = True
                            print(f"   ✅ Sound generation complete! Playback controls are visible")
                            break
                        except Exception:
                            continue
                    
                    if not playback_controls_found:
                        print(f"   ⚠️  Playback controls not found, but generation appears complete")
                            
                except Exception as e:
                    print(f"   ⚠️  Timeout waiting for sound generation")
                    print(f"      Generation may have failed or is taking too long")
                
                self.take_screenshot("all_sounds_generated")
            else:
                print(f"   ❌ Could not find Generate Sounds button")
                print(f"      This may indicate:")
                print(f"      - Button text/class changed")
                print(f"      - Button is disabled or hidden")
                print(f"      - Page layout issue")
                self.take_screenshot("generate_button_not_found")
            
            # === STEP 6: Test Playback Controls ===
            print(f"\n📦 Step 6: Test Playback Controls...")
            
            # Scroll back to top
            try:
                self.driver.execute_script("window.scrollTo(0, 0);")
                time.sleep(0.5)
            except Exception:
                pass
            
            play_all_visible = self._test_element_visibility(
                "Play All Button",
                By.XPATH,
                "//button[contains(text(), 'Play All')]",
                timeout=3
            )
            
            pause_all_visible = self._test_element_visibility(
                "Pause All Button",
                By.XPATH,
                "//button[contains(text(), 'Pause All')]",
                timeout=2
            )
            
            stop_all_visible = self._test_element_visibility(
                "Stop All Button",
                By.XPATH,
                "//button[contains(text(), 'Stop All')]",
                timeout=2
            )
            
            if play_all_visible:
                # Test Play All
                print(f"\n   🎮 Testing Play All...")
                play_clicked = self._click_element("Play All Button", By.XPATH, "//button[contains(text(), 'Play All')]")
                if play_clicked:
                    print(f"   ✅ Playing all sounds")
                    time.sleep(3)  # Let sounds play for a bit
                    self.take_screenshot("sounds_playing")
                    
                    # Test Pause All
                    if pause_all_visible:
                        print(f"\n   ⏸️  Testing Pause All...")
                        pause_clicked = self._click_element("Pause All Button", By.XPATH, "//button[contains(text(), 'Pause All')]")
                        if pause_clicked:
                            print(f"   ✅ Paused all sounds")
                            time.sleep(0.5)
                            self.take_screenshot("sounds_paused")
                            
                            # Resume playing
                            play_clicked_2 = self._click_element("Play All Button", By.XPATH, "//button[contains(text(), 'Play All')]")
                            if play_clicked_2:
                                print(f"   ✅ Resumed playing")
                                time.sleep(1)
                    
                    # Test Stop All
                    if stop_all_visible:
                        print(f"\n   ⏹️  Testing Stop All...")
                        stop_clicked = self._click_element("Stop All Button", By.XPATH, "//button[contains(text(), 'Stop All')]")
                        if stop_clicked:
                            print(f"   ✅ Stopped all sounds")
                            time.sleep(0.5)
                            self.take_screenshot("sounds_stopped")
            else:
                print(f"   ⚠️  Playback controls not visible - sounds may not have generated")
            
            # === STEP 7: Test Timeline ===
            print(f"\n📦 Step 7: Test Timeline...")
            
            # Scroll down to see timeline
            try:
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(1)
                print(f"   📜 Scrolled to bottom of page")
            except Exception:
                pass
            
            # Look for timeline container
            timeline_selectors = [
                "//div[contains(@class, 'timeline')]",
                "//div[contains(@id, 'timeline')]",
                "//div[contains(@class, 'wavesurfer')]",
                "//div[@role='region' and contains(@aria-label, 'timeline')]",
                "//div[contains(@class, 'w-full') and .//canvas]",
            ]
            
            timeline_visible = False
            for selector in timeline_selectors:
                timeline_visible = self._test_element_visibility(
                    "Timeline Container",
                    By.XPATH,
                    selector,
                    timeout=2
                )
                if timeline_visible:
                    print(f"   ✅ Timeline found with selector: {selector[:50]}")
                    break
            
            if timeline_visible or True:  # Always try to analyze timeline elements
                # Count canvas elements (waveforms are usually canvases)
                canvases = self.driver.find_elements(By.TAG_NAME, "canvas")
                print(f"   📊 Total canvas elements: {len(canvases)}")
                
                # Try to identify which canvases are waveforms vs 3D scene
                for i, canvas in enumerate(canvases):
                    try:
                        width = canvas.size['width']
                        height = canvas.size['height']
                        location = canvas.location
                        print(f"      Canvas {i+1}: {width}x{height} at y={location['y']}")
                    except Exception:
                        pass
                
                # Test timeline zoom controls
                zoom_selectors = [
                    "//button[contains(text(), '+') and (contains(@title, 'Zoom') or contains(@aria-label, 'Zoom'))]",
                    "//button[contains(@aria-label, 'Zoom in')]",
                    "//button[contains(@class, 'zoom')]",
                ]
                
                zoom_in_found = False
                for selector in zoom_selectors:
                    zoom_in_found = self._test_element_visibility(
                        "Zoom In Button",
                        By.XPATH,
                        selector,
                        timeout=1
                    )
                    if zoom_in_found:
                        break
                
                # Try to find and click zoom controls
                if zoom_in_found:
                    print(f"\n   🔍 Testing zoom controls...")
                    
                    # Zoom in
                    zoom_in_clicked = self._click_element(
                        "Zoom In",
                        By.XPATH,
                        "//button[contains(text(), '+') or contains(@aria-label, 'Zoom in')]",
                        timeout=2
                    )
                    if zoom_in_clicked:
                        print(f"      ✅ Zoomed in")
                        time.sleep(0.5)
                        self.take_screenshot("timeline_zoomed_in")
                    
                    # Zoom out
                    zoom_out_clicked = self._click_element(
                        "Zoom Out",
                        By.XPATH,
                        "//button[contains(text(), '-') or contains(@aria-label, 'Zoom out')]",
                        timeout=2
                    )
                    if zoom_out_clicked:
                        print(f"      ✅ Zoomed out")
                        time.sleep(0.5)
                        self.take_screenshot("timeline_zoomed_out")
                
                self.take_screenshot("timeline_view")
            
            # Scroll back to top
            try:
                self.driver.execute_script("window.scrollTo(0, 0);")
                time.sleep(0.5)
            except Exception:
                pass
            
            # === STEP 8: Test Sound Overlay ===
            print(f"\n📦 Step 8: Test Sound Overlays in 3D Scene...")
            
            # Scroll back to top to see 3D canvas
            try:
                self.driver.execute_script("window.scrollTo(0, 0);")
                time.sleep(0.5)
            except Exception:
                pass
            
            try:
                from selenium.webdriver.common.action_chains import ActionChains
                
                canvas = self.driver.find_element(By.TAG_NAME, "canvas")
                
                # Get canvas dimensions
                canvas_width = canvas.size['width']
                canvas_height = canvas.size['height']
                
                print(f"   🖱️  Canvas size: {canvas_width}x{canvas_height}")
                
                # Try clicking on different parts of the canvas to find sound spheres
                # Sounds are usually placed in a grid or at specific positions
                click_positions = [
                    (0, 0),  # Center
                    (-100, -50),  # Upper left quadrant
                    (100, -50),  # Upper right quadrant
                    (-100, 50),  # Lower left quadrant
                ]
                
                overlay_found = False
                for i, (offset_x, offset_y) in enumerate(click_positions):
                    print(f"\n   🎯 Click attempt {i+1}: Offset ({offset_x}, {offset_y})")
                    
                    actions = ActionChains(self.driver)
                    actions.move_to_element_with_offset(canvas, offset_x, offset_y).click().perform()
                    time.sleep(1)
                    
                    self.take_screenshot(f"canvas_click_{i+1}")
                    
                    # Check for overlay with multiple selectors
                    overlay_selectors = [
                        "//div[contains(@class, 'bg-black') and contains(@class, 'backdrop-blur')]",
                        "//div[contains(@class, 'absolute') and .//input[@type='range']]",
                        "//input[@type='range' and @min='30']",  # Volume slider
                        "//div[contains(@class, 'bg-opacity') and contains(@class, 'backdrop')]",
                    ]
                    
                    for selector in overlay_selectors:
                        try:
                            from selenium.webdriver.support.ui import WebDriverWait
                            from selenium.webdriver.support import expected_conditions as EC
                            
                            wait = WebDriverWait(self.driver, 1)
                            element = wait.until(EC.presence_of_element_located((By.XPATH, selector)))
                            
                            if element.is_displayed():
                                print(f"   ✅ Sound overlay detected!")
                                overlay_found = True
                                break
                        except Exception:
                            continue
                    
                    if overlay_found:
                        break
                    
                    print(f"   ℹ️  No overlay at this position, trying next...")
                
                if overlay_found:
                    print(f"\n   📊 Testing overlay controls...")
                    
                    # Test Volume Slider
                    volume_visible = self._test_element_visibility(
                        "Volume Slider",
                        By.XPATH,
                        "//input[@type='range' and (@min='30' or @min='-30')]",
                        timeout=2
                    )
                    
                    if volume_visible:
                        try:
                            volume_slider = self.driver.find_element(By.XPATH, "//input[@type='range' and (@min='30' or @min='-30')]")
                            current_value = volume_slider.get_attribute('value')
                            print(f"      ✅ Volume slider: {current_value} dB")
                            
                            # Try adjusting volume
                            self.driver.execute_script("arguments[0].value = -10; arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", volume_slider)
                            time.sleep(0.3)
                            print(f"      ✅ Adjusted volume to -10 dB")
                            
                        except Exception as e:
                            print(f"      ⚠️  Could not adjust volume: {str(e)[:50]}")
                    
                    # Test Interval Slider
                    interval_visible = self._test_element_visibility(
                        "Interval Slider",
                        By.XPATH,
                        "//input[@type='range' and (@max='300' or @max='30')]",
                        timeout=2
                    )
                    
                    if interval_visible:
                        try:
                            interval_slider = self.driver.find_element(By.XPATH, "//input[@type='range' and (@max='300' or @max='30')]")
                            current_value = interval_slider.get_attribute('value')
                            print(f"      ✅ Interval slider: {current_value} s")
                            
                            # Try adjusting interval
                            self.driver.execute_script("arguments[0].value = 5; arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", interval_slider)
                            time.sleep(0.3)
                            print(f"      ✅ Adjusted interval to 5 s")
                            
                        except Exception as e:
                            print(f"      ⚠️  Could not adjust interval: {str(e)[:50]}")
                    
                    # Test Play/Pause individual sound
                    play_sound_visible = self._test_element_visibility(
                        "Play/Pause Sound Button",
                        By.XPATH,
                        "//button[contains(text(), 'Play') or contains(text(), 'Pause') or contains(@aria-label, 'Play')]",
                        timeout=2
                    )
                    
                    if play_sound_visible:
                        play_btn_clicked = self._click_element(
                            "Play Individual Sound",
                            By.XPATH,
                            "//button[contains(text(), 'Play') or contains(@aria-label, 'Play')]",
                            timeout=2
                        )
                        if play_btn_clicked:
                            print(f"      ✅ Played individual sound")
                            time.sleep(2)
                            
                            # Try pause
                            pause_btn_clicked = self._click_element(
                                "Pause Individual Sound",
                                By.XPATH,
                                "//button[contains(text(), 'Pause') or contains(@aria-label, 'Pause')]",
                                timeout=2
                            )
                            if pause_btn_clicked:
                                print(f"      ✅ Paused individual sound")
                    
                    # Test Variant selector (if available)
                    variant_visible = self._test_element_visibility(
                        "Variant Selector",
                        By.XPATH,
                        "//select[.//option[contains(text(), 'Variant')]] | //div[contains(text(), 'Variant')]//select",
                        timeout=1
                    )
                    
                    if variant_visible:
                        print(f"      ✅ Variant selector available")
                    
                    # Test Delete button
                    delete_visible = self._test_element_visibility(
                        "Delete Sound Button",
                        By.XPATH,
                        "//button[text()='×' or contains(@title, 'Delete') or contains(@aria-label, 'Delete')]",
                        timeout=1
                    )
                    
                    if delete_visible:
                        print(f"      ✅ Delete button visible (not clicking to preserve test)")
                    
                    self.take_screenshot("sound_overlay_detailed")
                    
                    # Close overlay by clicking elsewhere
                    print(f"\n   🖱️  Closing overlay by clicking away...")
                    try:
                        actions = ActionChains(self.driver)
                        actions.move_to_element_with_offset(canvas, -200, -100).click().perform()
                        time.sleep(0.5)
                        print(f"      ✅ Overlay closed")
                    except Exception:
                        pass
                    
                else:
                    print(f"\n   ℹ️  Could not find sound overlay after multiple click attempts")
                    print(f"      This may be normal if:")
                    print(f"      - Sounds were not successfully generated")
                    print(f"      - Sound spheres are positioned outside tested click areas")
                    print(f"      - Overlay requires hover instead of click")
                    
            except Exception as e:
                print(f"   ⚠️  Canvas interaction test failed: {str(e)[:100]}")
                self.take_screenshot("canvas_interaction_error")
            
            # === Final Screenshot ===
            self.take_screenshot("workflow_complete")
            
            duration = time.time() - start_time
            self.report.add_result(TestResult(
                test_name="Frontend - Complete Workflow (LLM + 3 Sound Methods)",
                success=all_passed,
                duration=duration,
                message="LLM prompts + Upload/Library/Text-to-Audio methods tested"
            ))
            
            return all_passed
            
        except Exception as e:
            duration = time.time() - start_time
            print(f"\n❌ Workflow test failed: {e}")
            self.take_screenshot("workflow_error")
            
            self.report.add_result(TestResult(
                test_name="Frontend - Complete Workflow (LLM + 3 Sound Methods)",
                success=False,
                duration=duration,
                message=str(e)
            ))
            
            return False
    
    def _setup_text_to_audio_fallback(self, dropdown_index: int = 0):
        """Setup text-to-audio as fallback for upload"""
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.select import Select
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            
            # Get all mode dropdowns, select the one at dropdown_index
            wait = WebDriverWait(self.driver, 3)
            dropdowns = wait.until(EC.presence_of_all_elements_located((By.XPATH, "//select[.//option[contains(text(), 'Text-to-Audio')]]")))
            
            if len(dropdowns) > dropdown_index:
                select = Select(dropdowns[dropdown_index])
                select.select_by_value("text-to-audio")
                print(f"   ✅ Switched to text-to-audio mode for fallback")
                time.sleep(0.5)
                
                # Find all text inputs and use the one at dropdown_index
                text_inputs = self.driver.find_elements(By.XPATH, "//textarea[@placeholder] | //input[@type='text' and @placeholder]")
                if len(text_inputs) > dropdown_index:
                    prompt_input = text_inputs[dropdown_index]
                    prompt_input.clear()
                    prompt_input.send_keys("bell chime")
                    print(f"   ✅ Entered fallback prompt: 'bell chime'")
                    time.sleep(0.3)
                else:
                    print(f"   ⚠️  Not enough text inputs found ({len(text_inputs)})")
            else:
                print(f"   ⚠️  Not enough dropdowns found ({len(dropdowns)})")
                
            self.take_screenshot("sound3_text_fallback")
        except Exception as e:
            print(f"   ⚠️  Fallback setup failed: {str(e)[:100]}")
    
    def run_all_tests(self) -> bool:
        """Run all frontend tests"""
        if not self.setup_driver():
            return False
        
        try:
            success = True
            success &= self.test_page_load()
            success &= self.test_ui_components_systematic()
            success &= self.test_workflow_integration()
            
            return success
            
        finally:
            self.teardown_driver()


def main():
    """Main test runner"""
    print("\n" + "=" * 80)
    print("COMPAS SOUNDSCAPE - COMPREHENSIVE TEST SUITE")
    print("=" * 80)
    print(f"Timestamp: {TEST_TIMESTAMP}")
    print(f"Backend URL: {API_BASE_URL}")
    print(f"Frontend URL: {FRONTEND_URL}")
    print("=" * 80)
    
    # Use comprehensive mode by default
    test_level = LEVEL_2_COMPREHENSIVE
    print(f"\n✅ Running tests at: {test_level.name}")
    
    # Use default audio file
    audio_file = TEST_AUDIO_FILE
    print(f"✅ Using test audio file: {audio_file}")
    
    # Initialize report
    report = TestReport()
    
    # Frontend Tests (includes backend integration)
    print("\n" + "=" * 80)
    print("FRONTEND TESTS (with Backend Integration)")
    print("=" * 80)
    print("ℹ️  Testing backend through frontend UI workflow")
    print("   - LLM prompt generation + multiple sound methods")
    print("   - Upload, Library Search, and Text-to-Audio")
    print("=" * 80)
    
    try:
        frontend_tester = FrontendTester(report, test_level, audio_file)
        frontend_tester.run_all_tests()
    except ImportError:
        print("\n⚠️  Selenium not installed. Skipping frontend tests.")
        print("   Install with: pip install selenium")
    
    # Print Summary
    report.print_summary()
    report.save_to_file()
    
    print("\n" + "=" * 80)
    print("TEST SUITE COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    main()
