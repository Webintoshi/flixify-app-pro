#!/usr/bin/env python3
"""Release only the embedded_page API correction; keep published web and worker pinned."""
from __future__ import annotations
import importlib.util
import re
import sys
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reviewed = load("embedded_page_backend_transaction", Path(__file__).with_name("release-backend.py"))
build = load("embedded_page_hotfix_profile", Path(__file__).with_name("build-api-embedded.py"))
guard, GateError = reviewed.guard, reviewed.GateError
WEB_TAG = "flixify-ops-web:packages-8fa66d103053-20261101"
WEB_ID = "sha256:7e38728d71f62bc1fe63fa17cab209743f2618ad26e6ba4f6aaa6f301639a41c"
WORKER_TAG = "flixify-worker:packages-8fa66d103053-20261101"
WORKER_ID = "sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57"
original_configure = reviewed.configure


def target(service, revision):
    if service != "api" or not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("embedded_page_exact_api_revision_required")
    return "flixify-api:embedded-page-" + revision[:12] + "-20261101"


def configure(service, revision, candidate_id, web_tag, web_id, api_tag=None, api_id=None):
    target(service, revision)
    expected_web = "flixify-ops-web:embedded-page-" + revision[:12] + "-20261101"
    if web_tag != expected_web or not isinstance(web_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", web_id):
        raise GateError("embedded_page_matching_hotfix_web_pin_required")
    image = guard.image(web_id)
    labels = image.get("Config", {}).get("Labels") or {}
    layers = guard.image(WEB_ID).get("RootFS", {}).get("Layers") or []
    if (image.get("Id") != web_id or guard.image_id(web_tag) != web_id or web_id == WEB_ID or
            labels.get("org.opencontainers.image.revision") != revision or labels.get("vip.flixify.edge-recovery.base") != WEB_ID or
            not layers or image.get("RootFS", {}).get("Layers", [])[:len(layers)] != layers):
        raise GateError("embedded_page_hotfix_web_ancestry_differs")
    original_protected_pin = reviewed.protected_pin
    def exact_web_pin(name, tag, image_id):
        if (name, tag, image_id) != ("ops-web", web_tag, web_id):
            raise GateError("embedded_page_exact_verified_web_dependency_required")
        return tag, image_id
    reviewed.protected_pin = exact_web_pin
    try:
        original_configure(service, revision, candidate_id, web_tag, web_id, api_tag, api_id)
    finally:
        reviewed.protected_pin = original_protected_pin


reviewed.target, reviewed.configure = target, configure
reviewed.builder.configuration = build.configuration
reviewed.builder.WORKER_TAG, reviewed.builder.WORKER_ID = WORKER_TAG, WORKER_ID
# API_ID deliberately remains the initial permanent-registration proof, not the hotfix source image.
main = reviewed.main


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("release_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, guard.yaml.YAMLError) as error:
        print("release_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
