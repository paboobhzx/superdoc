import importlib
import io
import sys
import types
import unittest
from pathlib import Path


def _setup_path():
    root = Path(__file__).resolve().parents[1]
    layer = root / "layers" / "superdoc_utils"
    if str(layer) not in sys.path:
        sys.path.insert(0, str(layer))


def _install_logger_stub():
    logger = types.ModuleType("logger")
    logger.log_event = lambda *args, **kwargs: None
    sys.modules["logger"] = logger


def _text_pdf_bytes(text="sample words " * 30):
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), text)
    out = doc.tobytes()
    doc.close()
    return out


class PdfExtractionPipelineTests(unittest.TestCase):
    def setUp(self):
        _setup_path()
        _install_logger_stub()
        sys.modules.pop("pdf_extraction_pipeline", None)
        self.mod = importlib.import_module("pdf_extraction_pipeline")

    def test_normalize_extraction_mode_defaults_invalid_to_auto(self):
        self.assertEqual(self.mod.normalize_extraction_mode("bad"), "auto")
        self.assertEqual(self.mod.normalize_extraction_mode(None), "auto")
        self.assertEqual(self.mod.normalize_extraction_mode("tables"), "tables")

    def test_extract_text_pdf_returns_text_page(self):
        result = self.mod.extract_pdf(_text_pdf_bytes(), extraction_mode="auto", include_images=False)
        self.assertEqual(result.page_count, 1)
        self.assertTrue(result.has_any_text)
        self.assertGreater(result.pages[0].word_count, 3)

    def test_table_from_words_creates_multiple_columns(self):
        words = [
            self.mod.ExtractedWord("A", x0=10, x1=20, top=10, bottom=20),
            self.mod.ExtractedWord("B", x0=100, x1=110, top=10, bottom=20),
            self.mod.ExtractedWord("1", x0=10, x1=20, top=30, bottom=40),
            self.mod.ExtractedWord("2", x0=100, x1=110, top=30, bottom=40),
        ]
        table = self.mod._table_from_words(words)
        self.assertGreaterEqual(table.non_empty_rows, 2)
        self.assertEqual(table.rows[0][:2], ["A", "B"])


if __name__ == "__main__":
    unittest.main()
