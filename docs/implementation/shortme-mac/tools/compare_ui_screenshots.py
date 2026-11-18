#!/usr/bin/env python3
"""ShortMe UI parity: quantitative aid, NOT an automatic proof of 1:1 equivalence.

Compare two real UI screenshots at exactly the same pixel dimensions. Output metrics,
semi-transparent overlay and visual diff; do not resize or auto-mask any app content.
Requires Pillow. Usage documented in templates/ui_parity/README.md.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageEnhance, ImageStat


def compare(baseline: Path, actual: Path, out: Path) -> dict:
    a = Image.open(baseline).convert('RGB')
    b = Image.open(actual).convert('RGB')
    if a.size != b.size:
        raise ValueError(f'Pixel dimensions differ: baseline={a.size}, actual={b.size}. Recapture; do not resize.')
    diff = ImageChops.difference(a, b)
    stats = ImageStat.Stat(diff)
    pixel_total = a.width * a.height
    diff_pixels = list(diff.get_flattened_data())
    changed = sum(1 for color in diff_pixels if color != (0, 0, 0))
    changed_exceeds_24 = sum(1 for c in diff_pixels if max(c) > 24)
    out.parent.mkdir(parents=True, exist_ok=True)
    overlay = Image.blend(a, b, alpha=0.5)
    overlay.save(f'{out}-overlay.png')
    ImageEnhance.Contrast(diff).enhance(3).save(f'{out}-diff.png')
    metrics = {
        'baseline': str(baseline), 'actual': str(actual), 'width': a.width, 'height': a.height,
        'mean_abs_channel_diff_0_255': round(sum(stats.mean) / 3, 3),
        'changed_pixel_percent_any': round(100 * changed / pixel_total, 3),
        'changed_pixel_percent_gt24': round(100 * changed_exceeds_24 / pixel_total, 3),
        'acceptance': 'REQUIRES HUMAN PARITY REVIEW; numeric thresholds are not predefined',
        'note': 'Different operating systems can rasterize fonts differently. Diff is diagnostic only.'
    }
    Path(f'{out}-metrics.json').write_text(json.dumps(metrics, indent=2), encoding='utf-8')
    return metrics


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--baseline', type=Path, required=True)
    p.add_argument('--actual', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True, help='File prefix, e.g. ui-parity/diffs/import')
    a = p.parse_args()
    print(json.dumps(compare(a.baseline, a.actual, a.out), indent=2))


if __name__ == '__main__':
    main()
