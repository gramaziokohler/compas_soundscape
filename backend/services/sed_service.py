"""
Sound Event Detection (SED) Service

Uses Google's YAMNet model to detect and classify sound events in audio files.
Provides batch analysis with amplitude statistics and temporal information.
"""

import tensorflow as tf
import tensorflow_hub as hub
import numpy as np
import csv
import io
from typing import List, Dict, Optional
from utils.sed_processing import (
    load_audio,
    analyze_class_segments,
    calculate_amplitude_stats_for_class,
    DETECTION_THRESHOLD,
    FRAME_HOP_SECONDS,
    FRAME_WINDOW_SECONDS,
    TARGET_SAMPLE_RATE
)


class SEDService:
    """Service for Sound Event Detection using YAMNet model"""

    def __init__(self):
        """
        Initialize the SED service and load YAMNet model.

        Technical details:
            - YAMNet is loaded from TensorFlow Hub (Kaggle model repository)
            - Model includes AudioSet class names (521 sound event classes)
            - Loads synchronously on initialization for faster inference later
        """
        print("Loading YAMNet model...")
        try:
            # Load YAMNet model from TensorFlow Hub
            # hub.load() downloads and caches the model on first use
            self.model = hub.load('https://www.kaggle.com/models/google/yamnet/TensorFlow2/yamnet/1')

            # Load class names from the model's included CSV file
            # class_map_path() returns the path to yamnet_class_map.csv
            class_map_path = self.model.class_map_path().numpy()
            class_map_csv_text = tf.io.read_file(class_map_path).numpy().decode('utf-8')
            self.class_names = self._class_names_from_csv(class_map_csv_text)

            print(f"YAMNet model loaded successfully with {len(self.class_names)} classes")
        except Exception as e:
            print(f"Error loading YAMNet model: {e}")
            raise

    def _class_names_from_csv(self, class_map_csv_text: str) -> List[str]:
        """
        Parse YAMNet class names from CSV text.

        CSV format: index, mid (AudioSet ID), display_name
        Example: "0,/m/09x0r,Speech"

        Args:
            class_map_csv_text: CSV file content as string

        Returns:
            list: Display names for each class (521 classes for YAMNet)
        """
        class_map_csv = io.StringIO(class_map_csv_text)
        # csv.reader returns rows as [index, mid, display_name]
        class_names = [display_name for (class_index, mid, display_name) in csv.reader(class_map_csv)]
        class_names = class_names[1:]  # Skip CSV header row
        return class_names

    def analyze_audio_file(
        self,
        file_path: str,
        top_n_classes: int = 100,
        detection_threshold: float = DETECTION_THRESHOLD,
        analyze_amplitudes: bool = True,
        analyze_durations: bool = True
    ) -> Dict:
        """
        Analyze audio file and detect sound events with amplitude statistics.

        Processing pipeline:
            1. Load and preprocess audio (mono, 16kHz)
            2. Run YAMNet inference to get frame-by-frame scores
            3. Calculate mean scores across all frames
            4. Analyze temporal segments (detection/silence durations)
            5. Calculate amplitude statistics during detection periods
            6. Sort by confidence and return top N classes

        Args:
            file_path: Path to audio file (supports wav, mp3, flac, etc.)
            top_n_classes: Number of top classes to return (default: 100)
            detection_threshold: Confidence threshold for detection (default: 0.1)

        Returns:
            dict: {
                "success": bool,
                "audio_info": {
                    "duration": float (seconds),
                    "sample_rate": int,
                    "num_samples": int
                },
                "results": [
                    {
                        "name": str (class name),
                        "mean_score": float (0-1 confidence),
                        "max_amplitude_db": float (dBFS),
                        "max_amplitude_0_1": float (linear),
                        "avg_amplitude_db": float (dBFS RMS),
                        "avg_amplitude_0_1": float (linear RMS),
                        "detection_duration_range": str (e.g., "1.5s - 3.2s"),
                        "silence_duration_range": str
                    },
                    ...
                ],
                "error": str (if success=False)
            }
        """
        try:
            # Step 1: Load audio
            waveform, sample_rate = load_audio(file_path, TARGET_SAMPLE_RATE)
            if waveform is None:
                return {"success": False, "error": "Failed to load audio file"}

            # Calculate audio duration
            duration = len(waveform) / sample_rate if sample_rate > 0 else 0.0

            # Step 2: Run YAMNet inference
            print("Running YAMNet inference...")
            # Convert numpy array to TensorFlow tensor (required by model)
            waveform_tf = tf.constant(waveform, dtype=tf.float32)

            # Model returns: (scores, embeddings, spectrogram)
            # - scores: [num_frames, 521] confidence scores for each class
            # - embeddings: [num_frames, 1024] audio embeddings (not used here)
            # - spectrogram: [num_frames, 64] log-mel spectrogram
            scores, embeddings, log_mel_spectrogram = self.model(waveform_tf)
            scores_np = scores.numpy()  # Convert TensorFlow tensor to numpy
            num_frames = scores_np.shape[0]

            print(f"Inference complete: {num_frames} frames analyzed")

            # Step 3: Calculate mean scores across time
            # Mean score represents overall confidence for each class
            mean_scores = np.mean(scores_np, axis=0)  # Shape: [521]

            # Step 4 & 5: Analyze each class
            print(f"Analyzing {len(self.class_names)} sound classes...")
            all_results = []

            for i, class_name in enumerate(self.class_names):
                # Extract scores for this class across all frames
                class_scores = scores_np[:, i]  # Shape: [num_frames]
                mean_score = mean_scores[i]

                # Conditionally analyze detection/silence segments
                if analyze_durations:
                    detected_durations_sec, silent_durations_sec = analyze_class_segments(
                        class_scores, FRAME_HOP_SECONDS, detection_threshold
                    )
                    # Calculate max durations (use max instead of average for better representation)
                    max_detection_duration = float(np.max(detected_durations_sec)) if detected_durations_sec else None
                    max_silence_duration = float(np.max(silent_durations_sec)) if silent_durations_sec else None
                else:
                    max_detection_duration, max_silence_duration = None, None

                # Conditionally calculate amplitude statistics
                if analyze_amplitudes:
                    max_amp_0_1, max_amp_db, avg_amp_0_1, avg_amp_db = \
                        calculate_amplitude_stats_for_class(
                            waveform,
                            sample_rate,
                            class_scores,
                            FRAME_HOP_SECONDS,
                            FRAME_WINDOW_SECONDS,
                            detection_threshold
                        )
                    # Convert numpy floats to Python floats for JSON serialization
                    max_amp_0_1 = float(max_amp_0_1) if max_amp_0_1 is not None and not np.isinf(max_amp_0_1) else None
                    max_amp_db = float(max_amp_db) if max_amp_db is not None and not np.isinf(max_amp_db) else None
                    avg_amp_0_1 = float(avg_amp_0_1) if avg_amp_0_1 is not None and not np.isinf(avg_amp_0_1) else None
                    avg_amp_db = float(avg_amp_db) if avg_amp_db is not None and not np.isinf(avg_amp_db) else None
                else:
                    # Use None instead of -np.inf for JSON serialization compatibility
                    max_amp_0_1, max_amp_db, avg_amp_0_1, avg_amp_db = None, None, None, None

                all_results.append({
                    'name': class_name,
                    'mean_score': float(mean_score),  # Convert numpy float to Python float
                    'max_amplitude_db': max_amp_db,  # None or Python float
                    'max_amplitude_0_1': max_amp_0_1,  # None or Python float
                    'avg_amplitude_db': avg_amp_db,  # None or Python float
                    'avg_amplitude_0_1': avg_amp_0_1,  # None or Python float
                    'max_detection_duration_sec': max_detection_duration,  # None or float (seconds) - max value
                    'max_silence_duration_sec': max_silence_duration  # None or float (seconds) - max value
                })

            # Step 6: Sort by confidence and return top N
            # sorted() with key=lambda sorts by mean_score in descending order
            sorted_results = sorted(all_results, key=lambda item: item['mean_score'], reverse=True)
            top_results = sorted_results[:top_n_classes]

            print(f"Analysis complete: returning top {len(top_results)} classes")

            return {
                "success": True,
                "audio_info": {
                    "duration": float(duration),
                    "sample_rate": sample_rate,
                    "num_samples": len(waveform)
                },
                "results": top_results
            }

        except Exception as e:
            print(f"Error analyzing audio: {e}")
            return {"success": False, "error": str(e)}

    def get_model_info(self) -> Dict:
        """
        Get information about the loaded YAMNet model.

        Returns:
            dict: {
                "model_name": "YAMNet",
                "num_classes": int,
                "sample_rate": int,
                "frame_hop_seconds": float,
                "frame_window_seconds": float
            }
        """
        return {
            "model_name": "YAMNet",
            "num_classes": len(self.class_names),
            "sample_rate": TARGET_SAMPLE_RATE,
            "frame_hop_seconds": FRAME_HOP_SECONDS,
            "frame_window_seconds": FRAME_WINDOW_SECONDS
        }
