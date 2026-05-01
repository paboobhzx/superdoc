import json as _json
import os
import shutil
import subprocess
import tempfile

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)

_LIBREOFFICE_BIN = os.environ.get("LIBREOFFICE_BIN", "libreoffice")


def _xlsx_to_pdf(xlsx_bytes: bytes, sheet_name: str | None = None) -> bytes:
    from openpyxl import load_workbook

    if sheet_name:
        workbook_path = _select_sheet_workbook(xlsx_bytes, sheet_name)
        try:
            with open(workbook_path, "rb") as fh:
                return _office_to_pdf(fh.read(), "input.xlsx")
        finally:
            try:
                os.unlink(workbook_path)
            except FileNotFoundError:
                pass
    return _office_to_pdf(xlsx_bytes, "input.xlsx")


def _select_sheet_workbook(xlsx_bytes: bytes, sheet_name: str) -> str:
    import io

    wb = load_workbook(io.BytesIO(xlsx_bytes))
    path = ""
    try:
        if sheet_name:
            if sheet_name not in wb.sheetnames:
                raise ValueError(f"sheet not found: {sheet_name}")
            ws = wb[sheet_name]
        wb.active = wb.index(ws)
        for worksheet in wb.worksheets:
            worksheet.sheet_state = "visible" if worksheet.title == sheet_name else "hidden"
        fd, path = tempfile.mkstemp(prefix="selected-sheet-", suffix=".xlsx")
        os.close(fd)
        wb.save(path)
        return path
    finally:
        wb.close()


def _office_to_pdf(source_bytes: bytes, source_name: str) -> bytes:
    if not shutil.which(_LIBREOFFICE_BIN):
        raise RuntimeError(f"LibreOffice executable not found: {_LIBREOFFICE_BIN}")

    with tempfile.TemporaryDirectory(prefix="office-to-pdf-") as workdir:
        outdir = os.path.join(workdir, "out")
        profile = os.path.join(workdir, "profile")
        os.makedirs(outdir, exist_ok=True)
        os.makedirs(profile, exist_ok=True)

        source_path = os.path.join(workdir, source_name)
        with open(source_path, "wb") as fh:
            fh.write(source_bytes)

        cmd = [
            _LIBREOFFICE_BIN,
            "--headless",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            "--nolockcheck",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to",
            "pdf",
            "--outdir",
            outdir,
            source_path,
        ]
        completed = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=int(os.environ.get("LIBREOFFICE_TIMEOUT_SECONDS", "240")),
        )
        if completed.returncode != 0:
            stderr = completed.stderr.decode("utf-8", errors="replace").strip()
            stdout = completed.stdout.decode("utf-8", errors="replace").strip()
            detail = stderr or stdout or f"exit code {completed.returncode}"
            raise RuntimeError(f"LibreOffice PDF export failed: {detail}")

        pdf_path = os.path.join(outdir, f"{os.path.splitext(source_name)[0]}.pdf")
        if not os.path.exists(pdf_path):
            raise RuntimeError("LibreOffice PDF export did not produce an output file")

        with open(pdf_path, "rb") as fh:
            result = fh.read()
        if not result.startswith(b"%PDF"):
            raise RuntimeError("LibreOffice PDF export produced an invalid PDF")
        return result


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    params = body.get("params") or {}
    sheet_name = params.get("sheet") or body.get("sheet")

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _xlsx_to_pdf(data, sheet_name=sheet_name)
        out_key = s3.make_output_key(job_id, file_key, "output.pdf")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("xlsx_to_pdf done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("xlsx_to_pdf failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
