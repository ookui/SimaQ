#!/usr/bin/env python3
"""Create a repeatable search corpus in a new or empty directory."""
import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("--count", type=int, default=10000)
args = parser.parse_args()
args.directory.mkdir(parents=True, exist_ok=True)
if any(args.directory.iterdir()):
    parser.error("directory must be empty")
paragraph = "Investment research: quarterly revenue, margins and market share.\n" * 315
for i in range(args.count):
    text = paragraph + ("\nphysical-ai 独特词条\n" if i == 4567 else "")
    text += "\n中等样本 moderate-marker\n" if i % 10 == 0 else ""
    text += "\nwide-marker 广泛样本\n"
    (args.directory / f"note-{i}.md").write_text(text, encoding="utf-8")
print(f"Created {args.count} Markdown files in {args.directory}")
