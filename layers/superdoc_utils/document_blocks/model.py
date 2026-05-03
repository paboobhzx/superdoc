from dataclasses import dataclass, field


@dataclass(frozen=True)
class Inline:
    text: str
    bold: bool = False
    italic: bool = False
    code: bool = False
    href: str | None = None


@dataclass(frozen=True)
class Block:
    kind: str
    inlines: list[Inline] = field(default_factory=list)
    level: int = 0
    ordered: bool = False
    items: list[list[Inline]] = field(default_factory=list)
    text: str = ""
    headers: list[list[Inline]] = field(default_factory=list)
    rows: list[list[list[Inline]]] = field(default_factory=list)
    blocks: list["Block"] = field(default_factory=list)
