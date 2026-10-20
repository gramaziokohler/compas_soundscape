"""Runtime switches for research-study logging.

The ``STUDY_*`` values live in ``config/constants.py``; this module reads them
*at call time* (attribute lookup on the module) so a test can flip the master
switch without re-importing anything. A feature is on only while the master
switch is on AND its own kill-switch sub-flag is on.
"""

import config.constants as constants

# Feature name (as exposed in GET /api/study/config) -> sub-flag constant name.
_FEATURE_FLAGS = {
    "snapshots": "STUDY_FEATURE_SNAPSHOTS",
    "state_diff": "STUDY_FEATURE_STATE_DIFF",
    "pose_sampling": "STUDY_FEATURE_POSE_SAMPLING",
    "audio_archive": "STUDY_FEATURE_AUDIO_ARCHIVE",
    "server_job_events": "STUDY_FEATURE_SERVER_JOB_EVENTS",
    "moment_screenshot": "STUDY_FEATURE_MOMENT_SCREENSHOT",
}

# Features the frontend needs to know about (server_job_events is server-only).
CLIENT_FEATURES = ("snapshots", "state_diff", "pose_sampling", "audio_archive", "moment_screenshot")


def study_enabled() -> bool:
    """Master switch (env ``STUDY_LOGGING_ENABLED``)."""
    return bool(getattr(constants, "STUDY_LOGGING_ENABLED", False))


def study_feature(name: str) -> bool:
    """True when study logging is on and the feature's kill switch is not off."""
    flag = _FEATURE_FLAGS.get(name)
    return study_enabled() and flag is not None and bool(getattr(constants, flag, False))


def client_features() -> dict[str, bool]:
    return {name: study_feature(name) for name in CLIENT_FEATURES}
