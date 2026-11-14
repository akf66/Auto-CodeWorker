#!/usr/bin/env python3
"""Assemble console/app.js from console/src. No bundler: the parts are concatenated inside one closure."""
import pathlib
src = pathlib.Path(__file__).resolve().parent.parent / "console" / "src"
parts = ["head.js", "icons.js", "helpers.js", "dropdown.js", "v2.js", "app.body.js"]
out = "".join((src / p).read_text(encoding="utf-8") for p in parts) + "})();\n"
(src.parent / "app.js").write_text(out, encoding="utf-8")
print(f"console/app.js: {len(out)} bytes")
