"""Sending scenes from a shared workspace into the caller's own workspace."""

import pytest

from tests.test_transfer_scenes import _read, _service_env


def test_cross_workspace_copies_into_target_workspace(tmp_path, monkeypatch):
    service, store, root = _service_env(tmp_path, monkeypatch, with_target=False)
    shared = root / "ws"  # the helper's source workspace plays the shared one
    # A stale revision of the open (shared) workspace must not block the send.
    result = service.SceneTransferService().send_scenes(
        "ws", "model-a", "model-a", [1], base_revision=1, target_workspace_id="mine"
    )
    merged = _read(root / "mine" / "model-a" / "soundscape.json")
    assert result["cross_workspace"] is True and result["scenes_sent"] == 1
    assert store.calls == [("link", "model-a", "mine"), ("bump", "mine")]
    assert (shared / "model-a" / "soundscape.json").is_file()  # source untouched
    assert merged["sound_configs"]
    assert any((root / "mine" / "model-a" / "audio").iterdir())


def test_same_model_still_rejected_within_one_workspace(tmp_path, monkeypatch):
    service, _, _ = _service_env(tmp_path, monkeypatch)
    with pytest.raises(ValueError):
        service.SceneTransferService().send_scenes("ws", "model-a", "model-a", [1], target_workspace_id="ws")


def test_resolve_send_target_workspace(monkeypatch):
    import services.scene_transfer_service as service

    class Store:
        roles = {("shared", "u"): "viewer", ("mine", "u"): "owner"}

        def get_member_role(self, ws, user):
            return self.roles.get((ws, user))

        def get_owned_workspace(self, user):
            return {"id": "mine"} if user == "u" else None

    monkeypatch.setattr(service, "metadata_store", Store())
    assert service.resolve_send_target_workspace("mine", "u") == "mine"
    assert service.resolve_send_target_workspace("shared", "u") == "mine"
    assert service.resolve_send_target_workspace("anything", None) == "anything"
    with pytest.raises(PermissionError):
        service.resolve_send_target_workspace("other", "u")
