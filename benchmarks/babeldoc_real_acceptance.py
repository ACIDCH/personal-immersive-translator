"""Opt-in REAL BabelDOC end-to-end acceptance with user-owned PDF and API key.

Unlike simulated CI, this actually executes the installed BabelDOC program,
can download its own model assets and can incur provider fees. Nothing runs
unless the operator passes --acknowledge-billed-translation explicitly.

Usage:
  python -m benchmarks.babeldoc_real_acceptance \
    --input /path/to/owned-paper.pdf \
    --output /path/to/review-bilingual.pdf \
    --source en --target zh --acknowledge-billed-translation
Requires a separate BabelDOC installation and DEEPSEEK_API_KEY environment.
Only metrics, no document contents or API secrets, go to stdout.
"""
import argparse
import json
import os
import pathlib
import tempfile
from services.babeldoc_preflight import inspect_babeldoc_cli
from services.pdf_quality import inspect_pair

MAX_INPUT=25*1024*1024

def check_preconditions(args):
    if not args.acknowledge_billed_translation:
        raise ValueError("请先明确确认调用真实 BabelDOC 可能发生下载和翻译费用")
    if not os.environ.get("DEEPSEEK_API_KEY"):
        raise ValueError("DEEPSEEK_API_KEY 未配置，不能执行真实翻译")
    state=inspect_babeldoc_cli()
    if not state["compatible"]:
        raise ValueError("本机 BabelDOC CLI 不兼容：" + "、".join(state["missing"][:5]))
    source=pathlib.Path(args.input).expanduser().resolve(strict=True)
    destination=pathlib.Path(args.output).expanduser().absolute()
    if not source.is_file() or source.stat().st_size>MAX_INPUT:
        raise ValueError("只能提交不超过 25 MB 的合法 PDF 文件")
    if source==destination or destination.exists():
        raise ValueError("输出路径已经存在或与输入相同；拒绝覆盖现有文件")
    if args.source==args.target:
        raise ValueError("源语言和目标语言必须不同")
    return source,destination

def accept(args):
    source,dest=check_preconditions(args)
    from services import babeldoc_bridge as bridge
    if args.source not in bridge.LANGS or args.target not in bridge.LANGS:
        raise ValueError("不支持所选翻译语言")
    with tempfile.TemporaryDirectory(prefix="pit-real-babeldoc-") as folder:
        temp=pathlib.Path(folder)
        local=temp/"source.pdf"
        local.write_bytes(source.read_bytes())
        result=bridge.run_pipeline(local,temp,args.source,args.target,args.ocr)
        # Only save verified document, without clobbering any user files.
        with dest.open("xb") as output:
            output.write(result)
        quality=inspect_pair(source,dest)
    return {"output_created":True,"bytes":dest.stat().st_size,
            "source_pages":quality["input_pages"],
            "output_pages":quality["output_pages"],
            "outside_text_spans":quality["outside_text_spans"],
            "warnings":quality["warnings"],
            "quality_gate":quality["status"],
            "visual_comparison_required":True}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description="Actual paid BabelDOC local acceptance")
    parser.add_argument("--input",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--source",default="en")
    parser.add_argument("--target",default="zh")
    parser.add_argument("--ocr",action="store_true")
    parser.add_argument("--acknowledge-billed-translation",action="store_true")
    options=parser.parse_args()
    try:
        summary=accept(options)
    except (ValueError,OSError,RuntimeError) as error:
        parser.error(str(error))
    print(json.dumps(summary,ensure_ascii=False,indent=2))
