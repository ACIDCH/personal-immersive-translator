"""Safely probe an independently installed BabelDOC binary, without API keys.

This validates *declared CLI compatibility*, not successful model download,
valid credentials or layout-preserved translation on a real PDF.
"""
import shutil
import re
import subprocess

FLAGS=("--config","--files","--lang-in","--lang-out","--output",
       "--openai","--openai-model","--openai-base-url","--openai-api-key",
       "--no-mono")


def inspect_babeldoc_cli(path=None):
    binary=path or shutil.which("babeldoc")
    if not binary:
        return {"installed":False,"compatible":False,"missing":["babeldoc"]}
    try:
        response=subprocess.run([binary,"--help"],capture_output=True,
            text=True,timeout=12,check=True)
        help_text=(response.stdout or "")+"\n"+(response.stderr or "")
    except (OSError,UnicodeError,subprocess.SubprocessError):
        return {"installed":True,"compatible":False,
                "missing":["CLI help unavailable"]}
    # Do not treat --openai-model as evidence of a --openai flag, nor
    # --openai-api-key-v2 as the required --openai-api-key.
    # CLI flags have explicit token boundaries in argparse's --help output.
    missing=[flag for flag in FLAGS if not re.search(
        r"(?<![\w-])"+re.escape(flag)+r"(?![\w-])",help_text)]
    return {"installed":True,"compatible":not missing,"missing":missing}
