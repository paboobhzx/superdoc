# ReportLab page dimensions in points (1 pt = 1/72 inch).
# Used by fast (pure-Python) PDF handlers.
SIZES_PT: dict[str, tuple[float, float]] = {
    "A4":     (595.28, 841.89),
    "A3":     (841.89, 1190.55),
    "Letter": (612.0,  792.0),
    "Legal":  (612.0,  1008.0),
    "A5":     (419.53, 595.28),
}

DEFAULT = "A4"


def get(name: str | None) -> tuple[float, float]:
    return SIZES_PT.get(name or DEFAULT, SIZES_PT[DEFAULT])
