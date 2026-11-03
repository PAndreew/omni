#!/usr/bin/env python3
"""Deterministic extraction and layout-preserving replacement for text PDFs."""

import argparse
import json
import math
import sys
from pathlib import Path
from urllib.parse import urlparse

import pymupdf

MAX_PAGES = 100
MAX_BLOCKS = 2000
REGULAR_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def text_color(value: int) -> tuple[float, float, float]:
    return (((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)


def open_pdf(path: str) -> pymupdf.Document:
    document = pymupdf.open(path, filetype="pdf")
    if document.needs_pass:
        document.close()
        raise ValueError("Encrypted PDFs are not supported.")
    if document.page_count > MAX_PAGES:
        document.close()
        raise ValueError(f"PDF exceeds the {MAX_PAGES}-page safety limit.")
    return document


def extract(input_path: str, output_path: str) -> None:
    document = open_pdf(input_path)
    blocks = []
    try:
        for page_number, page in enumerate(document):
            page_data = page.get_text("dict", sort=True)
            for block_number, block in enumerate(page_data.get("blocks", [])):
                if block.get("type") != 0:
                    continue
                lines = block.get("lines", [])
                line_texts = []
                spans = []
                rotated = False
                for line in lines:
                    direction = line.get("dir", (1.0, 0.0))
                    if not (math.isclose(direction[0], 1.0, abs_tol=0.01) and math.isclose(direction[1], 0.0, abs_tol=0.01)):
                        rotated = True
                    line_spans = line.get("spans", [])
                    line_texts.append("".join(span.get("text", "") for span in line_spans))
                    spans.extend(line_spans)
                text = "\n".join(line_texts).strip()
                if not text:
                    continue
                if rotated:
                    raise ValueError(f"Rotated text is not yet supported (page {page_number + 1}).")
                if len(blocks) >= MAX_BLOCKS:
                    raise ValueError(f"PDF exceeds the {MAX_BLOCKS}-text-block safety limit.")
                representative = max(spans, key=lambda span: len(span.get("text", "")), default={})
                bbox = [float(value) for value in block["bbox"]]
                blocks.append({
                    "id": f"p{page_number + 1}-b{block_number + 1}",
                    "page": page_number,
                    "bbox": bbox,
                    "text": text,
                    "fontSize": float(representative.get("size", 11)),
                    "color": int(representative.get("color", 0)),
                    "bold": bool(int(representative.get("flags", 0)) & 16),
                })
        payload = {
            "version": 1,
            "pageCount": document.page_count,
            "blocks": blocks,
        }
        Path(output_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    finally:
        document.close()


def render(input_path: str, manifest_path: str, translations_path: str, output_path: str) -> None:
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    translations = json.loads(Path(translations_path).read_text(encoding="utf-8"))
    blocks = manifest["blocks"]
    by_id = {item["id"]: item["text"] for item in translations}
    expected = {block["id"] for block in blocks}
    if set(by_id) != expected:
        raise ValueError("Translated PDF block IDs do not exactly match extracted block IDs.")

    document = open_pdf(input_path)
    overflows = []
    try:
        blocks_by_page: dict[int, list[dict]] = {}
        for block in blocks:
            blocks_by_page.setdefault(block["page"], []).append(block)

        for page_number, page_blocks in blocks_by_page.items():
            page = document[page_number]
            for block in page_blocks:
                rect = pymupdf.Rect(block["bbox"])
                page.add_redact_annot(rect, fill=False, cross_out=False)
            page.apply_redactions(images=0, graphics=0, text=0)

            for block in page_blocks:
                rect = pymupdf.Rect(block["bbox"])
                rect.x0 = max(0, rect.x0 - 0.5)
                rect.y0 = max(0, rect.y0 - 0.5)
                rect.x1 = min(page.rect.width, rect.x1 + 0.5)
                rect.y1 = min(page.rect.height, rect.y1 + 1.5)
                original_size = max(5.0, min(float(block["fontSize"]), 72.0))
                minimum_size = max(5.0, original_size * 0.65)
                font_path = BOLD_FONT if block.get("bold") else REGULAR_FONT
                fitted = False
                size = original_size
                while size >= minimum_size:
                    shape = page.new_shape()
                    remaining = shape.insert_textbox(
                        rect,
                        by_id[block["id"]],
                        fontname="DejaVuSansBold" if block.get("bold") else "DejaVuSans",
                        fontfile=font_path,
                        fontsize=size,
                        lineheight=1.1,
                        color=text_color(int(block["color"])),
                    )
                    if remaining >= 0:
                        shape.commit(overlay=True)
                        fitted = True
                        break
                    size -= 0.5
                if not fitted:
                    overflows.append(block["id"])

        if overflows:
            raise ValueError(f"Translated text does not fit in {len(overflows)} block(s): {', '.join(overflows[:10])}")

        for page in document:
            for link in page.get_links():
                kind = link.get("kind")
                uri = link.get("uri", "")
                safe_uri = kind == pymupdf.LINK_URI and urlparse(uri).scheme.lower() in {"http", "https", "mailto"}
                if kind != pymupdf.LINK_GOTO and not safe_uri:
                    page.delete_link(link)

        document.scrub(
            attached_files=True,
            clean_pages=False,
            embedded_files=True,
            hidden_text=False,
            javascript=True,
            metadata=False,
            redactions=False,
            remove_links=False,
            reset_fields=False,
            reset_responses=False,
            thumbnails=False,
            xml_metadata=False,
        )
        document.save(output_path, garbage=4, clean=True, deflate=True)
    finally:
        document.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    extract_parser = subparsers.add_parser("extract")
    extract_parser.add_argument("input")
    extract_parser.add_argument("manifest")
    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("input")
    render_parser.add_argument("manifest")
    render_parser.add_argument("translations")
    render_parser.add_argument("output")
    args = parser.parse_args()
    if args.command == "extract":
        extract(args.input, args.manifest)
    else:
        render(args.input, args.manifest, args.translations, args.output)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
