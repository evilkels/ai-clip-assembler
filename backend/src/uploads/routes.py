"""The tus routes on the remote app: thin HTTP over ``UploadService``."""

import email.utils
from pathlib import Path
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, Request, Response
from fastapi.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from ..models import RemoteFinalizeRequest, RemoteUploadStatus
from ..remote.app import (
    Authed,
    RemoteHTTPError,
    open_exposed_project,
    require_session,
    runtime_of,
)
from ..remote.runtime import RemoteRuntime
from .naming import UploadRejected
from .service import (
    CHUNK_CEILING,
    MAX_UPLOAD_BYTES,
    TUS_ALGORITHMS,
    TUS_EXTENSIONS,
    TUS_VERSION,
    UploadService,
)

OFFSET_CONTENT_TYPE = "application/offset+octet-stream"


def _tus_headers(extra: Optional[dict] = None) -> dict:
    headers = {"Tus-Resumable": TUS_VERSION}
    headers.update(extra or {})
    return headers


def _http_date(timestamp: float) -> str:
    return email.utils.formatdate(timestamp, usegmt=True)


def _reject(exc: UploadRejected) -> RemoteHTTPError:
    return RemoteHTTPError(exc.status, exc.code, exc.message, headers=_tus_headers())


def _require_tus_version(request: Request) -> None:
    if request.headers.get("tus-resumable") != TUS_VERSION:
        raise RemoteHTTPError(
            412,
            "tus_version",
            "Unsupported tus version",
            headers={"Tus-Version": TUS_VERSION},
        )


def service_of(runtime: RemoteRuntime) -> UploadService:
    if runtime.uploads is None:
        runtime.uploads = UploadService()
    return runtime.uploads


def register_upload_routes(app: FastAPI, runtime: RemoteRuntime) -> None:
    service = service_of(runtime)
    runtime.auth.add_listener(
        lambda event, payload: service.on_device_ended(payload["device_id"])
        if event == "device_ended"
        else None
    )
    base = "/api/projects/{project_id}"

    async def project_root(request: Request, project_id: str) -> Path:
        _runtime_id, project = await run_in_threadpool(
            open_exposed_project, runtime_of(request), project_id
        )
        return Path(project["project_folder"])

    @app.options(base + "/uploads", include_in_schema=False)
    async def options_uploads(
        project_id: str, request: Request, authed: Annotated[Authed, Depends(require_session)]
    ):
        await project_root(request, project_id)
        return Response(
            status_code=204,
            headers=_tus_headers(
                {
                    "Tus-Version": TUS_VERSION,
                    "Tus-Extension": TUS_EXTENSIONS,
                    "Tus-Checksum-Algorithm": TUS_ALGORITHMS,
                    "Tus-Max-Size": str(MAX_UPLOAD_BYTES),
                }
            ),
        )

    @app.post(base + "/uploads", include_in_schema=False)
    async def create_upload(
        project_id: str, request: Request, authed: Annotated[Authed, Depends(require_session)]
    ):
        _require_tus_version(request)
        root = await project_root(request, project_id)
        try:
            upload, replayed = await run_in_threadpool(
                service.create,
                root,
                device_id=authed.device.device_id,
                device_label=authed.device.label,
                owner_login=authed.login,
                upload_length=request.headers.get("upload-length"),
                metadata_header=request.headers.get("upload-metadata"),
                idempotency_key=request.headers.get("idempotency-key"),
            )
        except UploadRejected as exc:
            raise _reject(exc) from exc
        runtime.store.audit(
            "upload_created", device=authed.device.device_id[:8], upload=upload.upload_id[:8]
        )
        headers = _tus_headers(
            {
                "Location": runtime.public_url(
                    f"/api/projects/{project_id}/uploads/{upload.upload_id}"
                ),
                "Upload-Expires": _http_date(service.expires_at(upload) or service.clock()),
            }
        )
        if replayed:
            headers["Idempotent-Replay"] = "true"
        return Response(status_code=201, headers=headers)

    @app.head(base + "/uploads/{upload_id}", include_in_schema=False)
    async def head_upload(
        project_id: str,
        upload_id: str,
        request: Request,
        authed: Annotated[Authed, Depends(require_session)],
    ):
        _require_tus_version(request)
        root = await project_root(request, project_id)
        try:
            upload = await run_in_threadpool(service.get, root, upload_id, authed.device.device_id)
        except UploadRejected as exc:
            raise _reject(exc) from exc
        headers = _tus_headers(
            {
                "Upload-Offset": str(upload.offset),
                "Upload-Length": str(upload.record.length),
                "Cache-Control": "no-store",
            }
        )
        expires = service.expires_at(upload)
        if expires is not None:
            headers["Upload-Expires"] = _http_date(expires)
        return Response(status_code=200, headers=headers)

    @app.patch(base + "/uploads/{upload_id}", include_in_schema=False)
    async def patch_upload(
        project_id: str,
        upload_id: str,
        request: Request,
        authed: Annotated[Authed, Depends(require_session)],
    ):
        _require_tus_version(request)
        if request.headers.get("content-type", "").split(";")[0].strip() != OFFSET_CONTENT_TYPE:
            raise RemoteHTTPError(415, "content_type", "Content-Type must be application/offset+octet-stream")
        offset_raw = request.headers.get("upload-offset", "")
        length_raw = request.headers.get("content-length", "")
        if not offset_raw.isdigit():
            raise RemoteHTTPError(400, "offset_required", "Upload-Offset is required")
        if not length_raw.isdigit():
            raise RemoteHTTPError(411, "length_required", "Content-Length is required")
        content_length = int(length_raw)
        if content_length > CHUNK_CEILING:
            raise RemoteHTTPError(413, "chunk_too_large", "Chunks are at most 8 MiB")
        root = await project_root(request, project_id)
        device_id = authed.device.device_id
        try:
            upload = await run_in_threadpool(service.get, root, upload_id, device_id)
            writer = await run_in_threadpool(
                service.begin_chunk,
                root,
                upload,
                offset=int(offset_raw),
                content_length=content_length,
                checksum_header=request.headers.get("upload-checksum"),
            )
        except UploadRejected as exc:
            raise _reject(exc) from exc

        handle = runtime.register_stream(device_id)
        try:
            async for piece in request.stream():
                if handle.is_closed:
                    await run_in_threadpool(writer.abort)
                    return _closed_response(handle.reason)
                if piece:
                    await run_in_threadpool(writer.write, piece)
            if handle.is_closed:
                await run_in_threadpool(writer.abort)
                return _closed_response(handle.reason)
            new_offset = await run_in_threadpool(writer.commit)
        except ClientDisconnect:
            await run_in_threadpool(writer.abort)
            return Response(status_code=499)
        except UploadRejected as exc:
            await run_in_threadpool(writer.abort)
            raise _reject(exc) from exc
        except BaseException:
            await run_in_threadpool(writer.abort)
            raise
        finally:
            runtime.unregister_stream(handle)
        headers = _tus_headers({"Upload-Offset": str(new_offset)})
        expires = service.expires_at(upload)
        if expires is not None:
            headers["Upload-Expires"] = _http_date(expires)
        return Response(status_code=204, headers=headers)

    @app.delete(base + "/uploads/{upload_id}", include_in_schema=False)
    async def delete_upload(
        project_id: str,
        upload_id: str,
        request: Request,
        authed: Annotated[Authed, Depends(require_session)],
    ):
        _require_tus_version(request)
        root = await project_root(request, project_id)
        try:
            upload = await run_in_threadpool(
                service.lookup, root, upload_id, authed.device.device_id
            )
            await run_in_threadpool(service.terminate, root, upload)
        except UploadRejected as exc:
            raise _reject(exc) from exc
        return Response(status_code=204, headers=_tus_headers())

    @app.get(
        base + "/upload-status/{upload_id}",
        response_model=RemoteUploadStatus,
        response_model_exclude_none=True,
    )
    async def upload_status(
        project_id: str,
        upload_id: str,
        request: Request,
        authed: Annotated[Authed, Depends(require_session)],
        chunks: bool = False,
    ):
        root = await project_root(request, project_id)
        try:
            upload = await run_in_threadpool(
                service.lookup, root, upload_id, authed.device.device_id
            )
        except UploadRejected as exc:
            raise _reject(exc) from exc
        return await run_in_threadpool(service.status, root, upload, include_chunks=chunks)

    register_finalize_route(app, runtime, service, base, project_root)


def _closed_response(reason: Optional[str]) -> Response:
    if reason == "remote-off":
        return Response(status_code=503, content=b'{"reason":"remote_off"}', media_type="application/json")
    return Response(
        status_code=401,
        content=b'{"reason":"%s"}' % (reason or "revoked").encode(),
        media_type="application/json",
    )


def register_finalize_route(app, runtime, service, base, project_root) -> None:
    """Finalization lands with task 1.9."""
    _ = (app, runtime, service, base, project_root, RemoteFinalizeRequest)
