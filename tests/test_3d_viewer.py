import io
import json
from types import SimpleNamespace
from urllib.parse import quote, urlparse


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class _FakeHandler:
    def __init__(self, headers=None):
        self.status = None
        self.sent_headers = []
        self.headers = headers or {}
        self.wfile = io.BytesIO()

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.sent_headers.append((name, value))

    def end_headers(self):
        pass

    def header(self, name):
        for key, value in self.sent_headers:
            if key.lower() == name.lower():
                return value
        return None

    def json(self):
        return json.loads(self.wfile.getvalue().decode("utf-8"))


def _info(routes, sid, path):
    handler = _FakeHandler()
    parsed = urlparse(
        f"http://example.com/api/file/info?session_id={quote(sid)}&path={quote(path)}"
    )
    routes._handle_file_info(handler, parsed)
    return handler


def _raw(routes, sid, path, headers=None):
    handler = _FakeHandler(headers=headers)
    parsed = urlparse(
        f"http://example.com/api/file/raw?session_id={quote(sid)}&path={quote(path)}"
    )
    routes._handle_file_raw(handler, parsed)
    return handler


def test_three_vendor_bundle_is_self_hosted_and_pinned():
    index = _read("static/index.html")
    vendor_readme = _read("static/vendor/three/0.184.0/README.md")

    assert '"three": "./static/vendor/three/0.184.0/three.module.js"' in index
    assert '"three/addons/": "./static/vendor/three/0.184.0/examples/jsm/"' in index
    assert "three-viewer.js?v=__WEBUI_VERSION__" in index
    assert "cdn.jsdelivr.net/npm/three" not in index
    assert "unpkg.com/three" not in index
    assert "three@0.184.0" in vendor_readme

    for path in [
        "static/vendor/three/0.184.0/three.module.js",
        "static/vendor/three/0.184.0/examples/jsm/controls/OrbitControls.js",
        "static/vendor/three/0.184.0/examples/jsm/loaders/STLLoader.js",
        "static/vendor/three/0.184.0/examples/jsm/loaders/OBJLoader.js",
        "static/vendor/three/0.184.0/examples/jsm/loaders/PLYLoader.js",
        "static/vendor/three/0.184.0/examples/jsm/loaders/GLTFLoader.js",
        "static/vendor/three/0.184.0/examples/jsm/loaders/3MFLoader.js",
    ]:
        assert _read(path), f"{path} must be vendored"


def test_3d_scripts_load_in_preview_order():
    index = _read("static/index.html")
    ui = index.index('src="static/ui.js?v=')
    registry = index.index('src="static/file-viewers.js?v=')
    workspace = index.index('src="static/workspace.js?v=')
    boot = index.index('src="static/boot.js?v=')
    viewer = index.index('src="static/three-viewer.js?v=')

    assert ui < registry < workspace < boot < viewer
    assert 'id="preview3dWrap"' in index
    assert 'id="preview3dTabs"' in index
    assert 'id="preview3dToolbar"' in index
    assert 'id="preview3dCanvasHost"' in index


def test_upload_accept_and_workspace_preview_route_3d_extensions():
    index = _read("static/index.html")
    workspace = _read("static/workspace.js")
    ui = _read("static/ui.js")
    boot = _read("static/boot.js")

    for ext in [".stl", ".obj", ".mtl", ".ply", ".glb", ".gltf", ".3mf"]:
        assert ext in index
    assert "MODEL_3D_EXTS" in workspace
    assert "HermesFileViewers.canPreview" in workspace
    assert "HermesFileViewers.open" in workspace
    assert "showPreview('3d')" in workspace
    assert "disposeActive" in boot
    assert "_MODEL_3D_EXTS" in ui
    assert "data-open-3d-attachment" in ui
    assert "openFile(fname,{forceViewer:true})" in ui
    assert "_waitForRegisteredFileViewer" in workspace


def test_viewer_registry_and_3d_tool_interfaces_are_exposed():
    registry = _read("static/file-viewers.js")
    viewer = _read("static/three-viewer.js")

    for needle in ["register", "canPreview", "open", "dispose:disposeActive"]:
        assert needle in registry
    assert "window.HermesFileViewers" in registry
    assert "window.dispatchEvent(new Event('HermesFileViewersReady'))" in registry
    assert "HermesFileViewerRegistered" in registry
    assert "Hermes3DReady" in viewer
    assert "window.Hermes3D" in viewer
    assert "registerTool(tool)" in viewer
    assert "hermes-3d-tabs:" in viewer
    assert "hermes-3d-view:" in viewer
    assert "External model resources are blocked" in viewer
    assert "objMtlRefs" in viewer
    assert "loadMtlMaterials" in viewer
    assert "api/file/" in viewer
    assert "/api/file/raw" in viewer or "api/file/raw" in viewer


def test_3d_uploads_can_use_viewer_size_cap():
    ui = _read("static/ui.js")
    upload_src = _read("api/upload.py")

    assert "MAX_3D_UPLOAD_BYTES" in ui
    assert "_uploadLimitBytesForFile" in ui
    assert "url.searchParams.set('viewer_type','3d')" in ui
    assert "MAX_3D_VIEWER_BYTES" in upload_src
    assert "_upload_request_limit" in upload_src
    assert "_upload_file_limit" in upload_src


def test_backend_3d_upload_limit_uses_viewer_cap():
    from api import upload
    from api.config import MAX_3D_VIEWER_BYTES, MAX_UPLOAD_BYTES

    normal = SimpleNamespace(path="/api/upload")
    model = SimpleNamespace(path="/api/upload?viewer_type=3d")

    assert upload._upload_request_limit(normal) == MAX_UPLOAD_BYTES
    assert upload._upload_request_limit(model) == max(MAX_UPLOAD_BYTES, MAX_3D_VIEWER_BYTES)
    assert upload._upload_file_limit("part.txt") == MAX_UPLOAD_BYTES
    assert upload._upload_file_limit("part.stl") == max(MAX_UPLOAD_BYTES, MAX_3D_VIEWER_BYTES)


def test_backend_mime_map_and_file_info_metadata(tmp_path, monkeypatch):
    from api import routes
    from api.config import MIME_MAP, MODEL_3D_EXTS

    sid = "s-3d-info"
    for ext in [".stl", ".obj", ".ply", ".glb", ".gltf", ".3mf"]:
        assert ext in MODEL_3D_EXTS
        assert MIME_MAP.get(ext)

    workspace = tmp_path / "ws"
    workspace.mkdir()
    model = workspace / "part.stl"
    body = b"solid hermes\nendsolid hermes\n"
    model.write_bytes(body)
    monkeypatch.setattr(routes, "get_session", lambda _sid: SimpleNamespace(workspace=str(workspace)))

    handler = _info(routes, sid, "part.stl")

    assert handler.status == 200
    payload = handler.json()
    assert payload == {
        "path": "part.stl",
        "name": "part.stl",
        "ext": ".stl",
        "mime": "model/stl",
        "size": len(body),
        "viewer_type": "3d",
    }
    assert str(workspace) not in handler.wfile.getvalue().decode("utf-8")


def test_file_info_rejects_traversal_without_exposing_paths(tmp_path, monkeypatch):
    from api import routes

    workspace = tmp_path / "ws"
    workspace.mkdir()
    monkeypatch.setattr(routes, "get_session", lambda _sid: SimpleNamespace(workspace=str(workspace)))

    handler = _info(routes, "s-3d-traversal", "../secret.stl")

    assert handler.status == 404
    assert str(tmp_path) not in handler.wfile.getvalue().decode("utf-8")


def test_raw_serves_3d_extensions_and_preserves_range_support(tmp_path, monkeypatch):
    from api import routes

    sid = "s-3d-raw"
    workspace = tmp_path / "ws"
    workspace.mkdir()
    files = {
        "part.stl": b"solid hermes\nendsolid hermes\n",
        "part.obj": b"o Hermes\nv 0 0 0\n",
        "part.ply": b"ply\nend_header\n",
        "part.glb": b"glTF" + b"\x00" * 16,
        "part.gltf": b'{"asset":{"version":"2.0"}}',
        "part.3mf": b"PK\x03\x04" + b"\x00" * 8,
    }
    for name, body in files.items():
        (workspace / name).write_bytes(body)
    monkeypatch.setattr(routes, "get_session", lambda _sid: SimpleNamespace(workspace=str(workspace)))

    for name, body in files.items():
        handler = _raw(routes, sid, name)
        assert handler.status == 200
        assert handler.wfile.getvalue() == body
        assert handler.header("Accept-Ranges") == "bytes"

    handler = _raw(routes, sid, "part.stl", headers={"Range": "bytes=0-4"})
    assert handler.status == 206
    assert handler.wfile.getvalue() == b"solid"
    assert handler.header("Content-Range") == f"bytes 0-4/{len(files['part.stl'])}"


def test_file_info_uses_session_attachment_fallback(tmp_path, monkeypatch):
    from api import routes, upload

    sid = "s-3d-attachment"
    workspace = tmp_path / "ws"
    inbox = tmp_path / "attachments" / sid
    workspace.mkdir()
    inbox.mkdir(parents=True)
    (inbox / "upload.glb").write_bytes(b"glTF" + b"\x00" * 4)
    monkeypatch.setattr(routes, "get_session", lambda _sid: SimpleNamespace(workspace=str(workspace)))
    monkeypatch.setattr(upload, "_session_attachment_dir", lambda _sid: inbox)

    handler = _info(routes, sid, "upload.glb")

    assert handler.status == 200
    payload = handler.json()
    assert payload["name"] == "upload.glb"
    assert payload["viewer_type"] == "3d"
    assert payload["mime"] == "model/gltf-binary"


def test_agent_plugin_visibility_is_not_reused_for_viewer_registry():
    panels = _read("static/panels.js")
    registry = _read("static/file-viewers.js")
    docs = _read("docs/EXTENSIONS.md")

    assert "/api/plugins" in panels
    assert "/api/plugins" not in registry
    assert "Viewer plugins versus Hermes Agent plugins" in docs
    assert "Hermes Agent plugins remain server/agent capabilities" in docs
