"""Actual BabelDOC 0.6.4 layout engine with local fake OpenAI-compatible MT.

Creates a new born-digital two-column PDF with vector shapes, formula text and
a table, launches REAL BabelDOC CLI through production PIT bridge, and checks
the resultant PDF with PyMuPDF. The LLM HTTP response is entirely synthetic
from loopback, hence this is layout-engine execution, NOT translation quality.

May download official BabelDOC assets on first run. No private PDF, keys, text
or image are stored as an artifact, and no remote AI billing is involved.
"""
import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import fitz

MODEL="pit-offline-fixture"


def make_pdf(target:Path):
    doc=fitz.open()
    page=doc.new_page(width=612,height=792)
    # Two-column article with a mathematical formula and bordered table.
    page.insert_text((38,48),"FINANCIAL NETWORKS: A CONTROLLED TWO-COLUMN STUDY",fontsize=11)
    left=["Network performance depends on capacity and demand.",
          "Operational resilience changes as disruptions spread.",
          "These sentences form a realistic academic paragraph."]
    right=["The second column contains the model interpretation.",
           "Demand forecasting can improve resource allocation.",
           "Numerical analysis needs accurate source typography."]
    for i,line in enumerate(left):
        page.insert_text((38,100+i*22),line,fontsize=9)
    for i,line in enumerate(right):
        page.insert_text((316,100+i*22),line,fontsize=9)
    page.insert_text((42,220),"Expected delay = demand / available capacity",fontsize=11)
    page.insert_text((42,253),"Capacity planning improves service reliability.",fontsize=10)
    page.draw_rect(fitz.Rect(42,296,570,379),color=(0,0,0),width=0.7)
    page.draw_line((42,334),(570,334),color=(0,0,0),width=0.7)
    page.draw_line((306,296),(306,379),color=(0,0,0),width=0.7)
    for x,y,t in [(55,320,"Market demand"),(320,320,"System capacity"),
                  (55,360,"Demand increases over time"),(320,360,"Capacity stays limited")]:
        page.insert_text((x,y),t,fontsize=9)
    page.draw_circle((100,460),30,color=(.1,.4,.6),fill=(.8,.9,1))
    page.insert_text((143,464),"Diagram source geometry should remain visible.",fontsize=9)
    doc.save(target)
    doc.close()


class LocalCompletions(BaseHTTPRequestHandler):
    requests=0
    def log_message(self,*args):
        pass
    def do_POST(self):
        if not self.path.endswith("/chat/completions"):
            self.send_error(404);return
        if self.headers.get("Authorization")!="Bearer isolated-fixture-key":
            self.send_error(401);return
        try:
            size=int(self.headers.get("Content-Length","0"))
            if not 0<size<=300000:raise ValueError("body too large")
            data=json.loads(self.rfile.read(size))
            message=str(data["messages"][-1]["content"])
            # Placeholder-preserving echo is enough to exercise geometry and
            # OCR/text output; it does NOT prove semantic MT quality.
            response=message
            if message.startswith(";; Treat next line as plain text input"):
                response=message.partition("Input:\n\n")[2]
            # This route is intentionally not a live cloud LLM.
            self.__class__.requests+=1
            payload=json.dumps({"id":"chatcmpl-local-fixture","object":"chat.completion",
                "created":1,"model":MODEL,
                "choices":[{"index":0,"finish_reason":"stop",
                            "message":{"role":"assistant","content":response}}],
                "usage":{"prompt_tokens":10,"completion_tokens":10,"total_tokens":20}}
                ).encode()
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Length",str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (ValueError,TypeError,KeyError):
            self.send_error(400)


def run(report_file:Path):
    from services.babeldoc_preflight import inspect_babeldoc_cli
    status=inspect_babeldoc_cli()
    if not status["compatible"]:
        raise RuntimeError("Actual BabelDOC CLI is missing/incompatible: "+
                           repr(status["missing"]))
    with tempfile.TemporaryDirectory(prefix="pit-true-babeldoc-layout-") as root:
        base=Path(root)
        original=base/"fixture-source.pdf"
        make_pdf(original)
        server=ThreadingHTTPServer(("127.0.0.1",0),LocalCompletions)
        worker=threading.Thread(target=server.serve_forever,daemon=True)
        worker.start()
        try:
            os.environ.update({
                "PIT_PDF_API_KEY":"isolated-fixture-key",
                "PIT_PDF_MODEL":MODEL,
                "PIT_PDF_BASE_URL":f"http://127.0.0.1:{server.server_port}/v1"
            })
            from services.babeldoc_bridge import run_pipeline
            started=time.monotonic()
            output=run_pipeline(original,base,"en","zh",False)
            seconds=round(time.monotonic()-started,2)
        finally:
            server.shutdown()
            worker.join(timeout=5)
            server.server_close()
        bilingual=base/"validated-output.pdf"
        bilingual.write_bytes(output)
        from services.pdf_quality import inspect_pair
        qa=inspect_pair(original,bilingual)
        # Real layout inference is only proven if at least one external
        # localhost model request was made and the resulting PDF is parseable.
        if LocalCompletions.requests<1:raise RuntimeError("BabelDOC never requested mock MT")
        if qa["output_pages"]<qa["input_pages"]:raise RuntimeError("BabelDOC dropped pages")
        if qa["output_text_pages"]<1:raise RuntimeError("BabelDOC lost all text")
        # Rendering with the PDF renderer catches broken page streams/font
        # objects that simple header/metadata checks do not detect.
        with fitz.open(bilingual) as parsed:
            rendered=[len(page.get_pixmap(matrix=fitz.Matrix(.55,.55)).samples)
                      for page in parsed]
        if not all(count>4000 for count in rendered):
            raise RuntimeError("Rendered PDF page is blank or malformed")
        metrics={
            "engine":"official BabelDOC CLI (not synthetic CLI replacement)",
            "babeldoc_compatibility":status["compatible"],
            "translation_api":"loopback deterministic stub; zero external AI requests",
            "fixture_type":"generated 2-column born-digital PDF with vector/table/formula",
            "model_request_count":LocalCompletions.requests,
            "elapsed_seconds":seconds,
            "input_pages":qa["input_pages"],
            "output_pages":qa["output_pages"],
            "output_text_pages":qa["output_text_pages"],
            "outside_spans":qa["outside_text_spans"],
            "quality_gate":qa["status"],
            "rendered_pages":len(rendered),
            "real_engine_executed":True,
            "linguistic_translation_evaluated":False,
            "layout_visual_human_review_required":True
        }
    report_file.write_text(json.dumps(metrics,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
    print(json.dumps({"real_babeldoc_executed":True,
                      "pages":metrics["output_pages"],
                      "mocked_provider_calls":metrics["model_request_count"],
                      "layout_review_needed":True},ensure_ascii=False))


if __name__=="__main__":
    run(Path("actual-babeldoc-layout-probe.json"))
